// During and after the event (server/delightafter.js): the cards, drawn where people already are.
// - Guest event pages (/e/<id>, /g#rsvp-<id>; loaded by public/event-extras.js): the morning-of card, "Add a photo"
//   while it's on, and "How was it?" the morning after (one-tap kudos, a private note, "Added to your scrapbook").
// - Plans (/plans; loaded by public/shell.js): the same cards for today's and yesterday's plans, and a keep-in-touch line.
// - The host's manage view (/?app=1, the #hv overview): the hour-before checklist, live photos, how it went, the
//   polaroid recap to post, and Potto's next date.
// - Settings: one switch per moment.
// Field Notes kit: --pl-* tokens, IBM Plex Sans, 6px corners, 44px taps, no emoji. Nothing opens by itself.
(function () {
  if (window.PLDelight) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const q = (s, el) => (el || document).querySelector(s), qa = (s, el) => [...(el || document).querySelectorAll(s)];
  const ID = /^[A-Za-z0-9_-]{2,80}$/, signed = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  async function api(url, body, method) { const r = await fetch(url, { method: method || (body !== undefined ? "POST" : "GET"), credentials: "same-origin", headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch {} if (!r.ok) throw new Error(j?.message || "That didn't work. Try again."); return j; }
  const seen = new Set(); const track = (moment, act, eventId) => { const k = moment + act + eventId; if (act !== "tap" && seen.has(k)) return; seen.add(k); fetch("/api/delight/track", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moment, act, eventId }) }).catch(() => {}); };
  const proofOf = (id) => { try { const M = JSON.parse(localStorage.getItem("encore-rsvp-" + id) || "null"); return M?.rid && M.code ? { rid: M.rid, code: M.code } : null; } catch { return null; } };
  const CSS = `.dl{box-sizing:border-box;margin:16px 0;padding:16px;background:var(--pl-surface,#FAF8F3);border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;color:var(--pl-ink,#1B1D1C);font:16px/1.45 "IBM Plex Sans",system-ui,sans-serif;text-align:left}
.dl *{box-sizing:border-box}.dl .dl-h{margin:0 0 4px;font:600 19px/1.25 "IBM Plex Sans",system-ui,sans-serif;letter-spacing:0;color:var(--pl-ink,#1B1D1C);overflow-wrap:anywhere}.dl .dl-in{margin:-6px 0 8px 38px}.dl .dl-h .dl-t{display:inline-flex;align-items:center;min-height:44px;color:inherit;text-decoration:none}@media (hover:hover){.dl .dl-h .dl-t:hover{text-decoration:underline}}.dl-scrap{padding:12px 16px}.dl .dl-k{margin:0 0 4px;font:600 13px/1.3 "IBM Plex Sans",system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--pl-soft,#444845)}
.dl p{margin:6px 0 0;overflow-wrap:anywhere}.dl .dl-s{color:var(--pl-soft,#444845);font-size:15px}.dl dl{display:grid;grid-template-columns:auto 1fr;gap:8px 14px;margin:12px 0 0}.dl dt{font-weight:600;font-size:15px;color:var(--pl-soft,#444845)}.dl dd{margin:0;overflow-wrap:anywhere}
.dl ul{margin:6px 0 0;padding-left:20px}.dl blockquote{margin:12px 0 0;padding:2px 0 2px 12px;border-left:3px solid var(--pl-accent,#29489A)}.dl blockquote p{margin:0}.dl blockquote cite{display:block;font-style:normal;font-size:14px;color:var(--pl-soft,#444845);margin-top:2px}
.dl .dl-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.dl .dl-b{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 16px;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;background:var(--pl-raised,#fff);color:var(--pl-ink,#1B1D1C);font:600 15px/1.2 "IBM Plex Sans",system-ui,sans-serif;text-decoration:none;cursor:pointer;text-align:center;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.dl .dl-b.go{background:var(--pl-accent,#29489A);border-color:var(--pl-accent,#29489A);color:#fff}.dl .dl-b:disabled{opacity:.6;cursor:default}.dl .dl-row .dl-b{flex:1 1 140px}
.dl .dl-chip[aria-pressed=true]{background:var(--pl-ink,#1B1D1C);color:var(--pl-raised,#fff)}
@media (hover:hover){.dl .dl-b:not(:disabled):hover{background:var(--pl-sand-soft,#EFEBE2)}.dl .dl-b.go:not(:disabled):hover{background:var(--pl-accent,#29489A);filter:brightness(1.1)}.dl .dl-chip[aria-pressed=true]:hover{background:var(--pl-ink,#1B1D1C)}}
.dl .dl-b:focus-visible,.dl a:focus-visible,.dl textarea:focus-visible,.dl input:focus-visible{outline:3px solid var(--pl-accent,#29489A);outline-offset:2px}
.dl a{color:var(--pl-accent,#29489A)}.dl .dl-l{display:inline-flex;align-items:center;min-height:44px;font-weight:600}
.dl textarea,.dl input[type=text],.dl input[type=date]{display:block;width:100%;min-height:44px;margin-top:6px;padding:10px 12px;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;background:var(--pl-raised,#fff);color:var(--pl-ink,#1B1D1C);font:16px/1.4 "IBM Plex Sans",system-ui,sans-serif}
.dl input[type=date]{height:44px;padding:0 12px;line-height:44px}.dl label.dl-f{display:block;margin-top:12px;font-weight:600;font-size:15px}
.dl .dl-ck{list-style:none;margin:12px 0 0;padding:0}.dl .dl-ck li{border-top:1px solid var(--pl-line,#CFC8B9)}.dl .dl-ck li:first-child{border-top:0}
.dl .dl-ck button{display:grid;grid-template-columns:28px 1fr;gap:10px;align-items:start;width:100%;min-height:52px;padding:10px 0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dl .dl-ck i{display:grid;place-items:center;width:24px;height:24px;margin-top:1px;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;font-style:normal}.dl .dl-ck [aria-pressed=true] i{background:var(--pl-ink,#1B1D1C);color:var(--pl-raised,#fff)}.dl .dl-ck [aria-pressed=true] b{text-decoration:line-through;text-decoration-thickness:1px}
.dl .dl-ck b{display:block;font-weight:600}.dl .dl-ck small{display:block;color:var(--pl-soft,#444845);font-size:14px;overflow-wrap:anywhere}
.dl .dl-pol{display:flex;gap:10px;overflow-x:auto;margin:12px -16px 0;padding:2px 16px 8px;scrollbar-width:none}.dl .dl-pol::-webkit-scrollbar{display:none}
.dl .dl-pol button{flex:0 0 132px;padding:7px 7px 0;border:1px solid var(--pl-line,#CFC8B9);border-radius:6px;background:#FFFEFA;cursor:pointer;text-align:left;font:inherit;color:inherit}
.dl .dl-pol img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:2px;background:var(--pl-sand-soft,#EFEBE2)}.dl .dl-pol span{display:block;padding:6px 1px 8px;font:500 13px/1.2 "IBM Plex Sans",system-ui,sans-serif;letter-spacing:.04em;color:#444845}
.dl .dl-pol button[aria-pressed=false]{opacity:.45}.dl .dl-pol button[aria-pressed=false] span::after{content:" · left out"}
.dl .dl-ppl{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.dl .dl-ppl button{min-height:44px;padding:0 14px;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;background:var(--pl-raised,#fff);color:inherit;font:500 15px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer}
.dl .dl-ppl button[aria-pressed=true]{border-color:var(--pl-ink,#1B1D1C);background:var(--pl-sand-soft,#EFEBE2);font-weight:600}
.dl .dl-msg{min-height:0;margin:8px 0 0;font-size:15px;color:var(--pl-soft,#444845)}.dl .dl-msg:empty{display:none}.dl hr{border:0;border-top:1px solid var(--pl-line,#CFC8B9);margin:16px 0}
.dl details summary{display:flex;align-items:center;min-height:44px;font-weight:600;cursor:pointer;color:var(--pl-accent,#29489A)}
.dl-set .row{display:flex;justify-content:space-between;gap:12px;align-items:center;min-height:48px}`;
  const css = () => { if (document.getElementById("dlCss")) return; const s = document.createElement("style"); s.id = "dlCss"; s.textContent = CSS; document.head.appendChild(s); };
  const CHECK = '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5l4 4 8-9"/></svg>';
  const msg = (box, t) => { const m = q(".dl-msg", box); if (m) m.textContent = t || ""; };

  // ---------------------------------------------------------------- the guest's cards
  function dayofHtml(d, { live = false } = {}) { if (!d) return "";
    return `<p class="dl-k">${live ? "On now" : "Today"}</p><p class="dl-h" role="heading" aria-level="2">${esc(d.title)}</p><dl>${d.time ? `<dt>Starts</dt><dd>${esc(d.time)}</dd>` : ""}${d.where ? `<dt>Where</dt><dd>${esc(d.where)}${d.locked ? `<span class="dl-s"> · the address shows once you're in</span>` : ""}</dd>` : ""}
      ${d.who?.line ? `<dt>Coming</dt><dd>${esc(d.who.line)}</dd>` : ""}${d.weather ? `<dt>Weather</dt><dd>${esc(d.weather)}</dd>` : ""}${d.bring?.length ? `<dt>Bring</dt><dd>${esc(d.bring.join(", "))}</dd>` : ""}</dl>
      ${d.note ? `<blockquote><p>${esc(d.note)}</p><cite>${esc(d.host || "Your host")}</cite></blockquote>` : ""}`; }
  function liveHtml(c) { const L = c.live || {};
    if (L.noPhotos) return `<p class="dl-k">On now</p><p class="dl-h" role="heading" aria-level="2">Phones down tonight</p><p class="dl-s">${esc(c.dayof?.host || "The host")} asked for no photos, so there's no photo wall for this one.</p>`;
    return `<p class="dl-k">On now</p><p class="dl-h" role="heading" aria-level="2">Add a photo from tonight</p><p class="dl-s">It goes straight into the night's recap and your scrapbook. ${esc(c.dayof?.host || "The host")} can hide any photo.</p>
      <div class="dl-row"><button type="button" class="dl-b" data-dl-photo>Add a photo</button></div><p class="dl-msg" aria-live="polite">${L.photos ? `${L.photos} ${L.photos === 1 ? "photo" : "photos"} from tonight so far.` : ""}</p>`; }
  function afterHtml(c) { const A = c.after; if (!A) return ""; const h = esc(A.host || "your host");
    return `<p class="dl-k">The morning after</p><p class="dl-h" role="heading" aria-level="2">How was ${esc(A.title)}?</p><p class="dl-s">${A.sent ? `Kudos sent. ${h} will see them.` : `One tap sends ${h} kudos.`}</p>
      <div class="dl-row" role="group" aria-label="Kudos for ${h}">${A.chips.map((x) => `<button type="button" class="dl-b dl-chip" data-dl-kudos="${esc(x.id)}" aria-pressed="${A.tags.includes(x.id)}">${esc(x.label)}</button>`).join("")}</div>
      <label class="dl-f" for="dlNote-${esc(c.eventId)}">A note just for ${h} <span class="dl-s">(optional, only ${h} sees it)</span></label><textarea id="dlNote-${esc(c.eventId)}" rows="2" maxlength="500" placeholder="${A.noted ? "Your note is sent. Write again to replace it." : "Thank you for..."}"></textarea>
      <div class="dl-row"><button type="button" class="dl-b" data-dl-note>Send the note</button></div><p class="dl-msg" aria-live="polite"></p>
      ${c.scrapbook ? `<hr><p>${esc(c.scrapbook.line)} <a class="dl-l" href="${esc(c.scrapbook.link)}">See your year</a></p>` : ""}`; }
  function cardHtml(c) { if (c.phase === "dayof" && c.dayof) return dayofHtml(c.dayof) + (c.dayof.chat ? `<div class="dl-row"><a class="dl-b" href="${esc(c.dayof.chat)}">Open the group chat</a></div>` : "");
    if (c.phase === "live" && c.live) return liveHtml(c) + (c.dayof ? `<details><summary>Today's details</summary>${dayofHtml(c.dayof, { live: true }).replace(/<p class="dl-k">[^<]*<\/p><p class="dl-h" role="heading" aria-level="2">[^<]*<\/p>/, "")}</details>` : "");
    if (c.phase === "after" && c.after) return afterHtml(c); return ""; }
  function wireGuest(box, c, proof) { const id = c.eventId, P = proof || c.proof || proofOf(id) || {};
    track(c.phase, "show", id);
    if (c.phase === "live" && !c.live?.noPhotos && !window.MomentUpload && !document.querySelector('script[src="/momentupload.js"]')) { const s = document.createElement("script"); s.src = "/momentupload.js"; document.head.appendChild(s); }
    const ph = q("[data-dl-photo]", box); if (ph) ph.onclick = () => { if (!window.MomentUpload) return msg(box, "One second, then tap again.");
      window.MomentUpload.pick({ q: { eventId: id, ...(P.rid ? { rid: P.rid, code: P.code } : {}) }, max: 6, accept: "image/jpeg,image/png,image/webp,image/gif", onStart: (f) => { ph.disabled = true; msg(box, f.length === 1 ? "Adding your photo." : `Adding ${f.length} photos.`); },
        onEach: (f, r, e) => { if (e) msg(box, e.message); }, onDone: (n) => { ph.disabled = false; if (n) { c.live.photos = (c.live.photos || 0) + n; msg(box, `Added. ${c.live.photos} ${c.live.photos === 1 ? "photo" : "photos"} from tonight so far.`); track("live_photo", "tap", id); } } }); };
    qa("[data-dl-kudos]", box).forEach((b) => b.onclick = async () => { if (!P.rid) return msg(box, "Open this from the link in your invite to send kudos.");
      const on = b.getAttribute("aria-pressed") !== "true", tags = qa("[data-dl-kudos]", box).filter((x) => (x === b ? on : x.getAttribute("aria-pressed") === "true")).map((x) => x.dataset.dlKudos); if (!tags.length) return;
      b.disabled = true; try { await api("/api/public/kudos", { eventId: id, rid: P.rid, code: P.code, tags, via: "ask" }); b.setAttribute("aria-pressed", String(on)); c.after.tags = tags; c.after.sent = true; q(".dl-s", box).textContent = `Kudos sent. ${c.after.host || "Your host"} will see them.`; track("kudos", "tap", id); } catch (e) { msg(box, e.message); } b.disabled = false; });
    const nb = q("[data-dl-note]", box); if (nb) nb.onclick = async () => { const t = q("textarea", box).value.trim(); if (t.length < 2) return msg(box, "Write a few words first."); nb.disabled = true;
      try { await api(`/api/delight/after/${encodeURIComponent(id)}/note`, { ...P, text: t }); q("textarea", box).value = ""; msg(box, `Sent. Only ${c.after.host || "your host"} sees it.`); track("after", "tap", id); } catch (e) { msg(box, e.message); } nb.disabled = false; };
  }

  // ---------------------------------------------------------------- the guest event page
  const pageId = () => (location.pathname.match(/^\/[ei]\/([A-Za-z0-9_-]{2,80})/) || location.hash.match(/^#rsvp-([A-Za-z0-9_-]+)/) || [])[1] || "";
  let G = null; // { id, data, box }
  function anchorGuest() { if (/^\/[ei]\//.test(location.pathname)) return q("#m > .facts"); const v = q("#view-guest"); if (!v || v.offsetParent === null) return null; return q(".invite.gx", v); }
  // the full invite already asks a past event's guests for kudos (with a note only the host sees): there, only the scrapbook line joins it
  function placeGuest() { if (!G?.box) return; const ask = G.c?.phase === "after" && location.pathname === "/g" ? q("#view-guest #kudosAsk") : null;
    if (ask) { G.box.remove(); if (G.alt && ask.nextElementSibling !== G.alt) ask.after(G.alt); return; } const at = anchorGuest(); if (at && (location.pathname === "/g" ? at.nextElementSibling !== G.box : !G.box.isConnected)) at.after(G.box); }
  async function guestPage() { const id = pageId(); if (!ID.test(id) || G?.id === id) return; G = { id }; const P = proofOf(id);
    let c = null; try { c = await api(`/api/delight/event/${encodeURIComponent(id)}${P ? `?rid=${encodeURIComponent(P.rid)}&code=${encodeURIComponent(P.code)}` : ""}`); } catch { return; }
    const html = cardHtml(c); if (!html || G.id !== id) return; css(); const box = document.createElement("section"); box.className = "dl"; box.setAttribute("aria-label", c.phase === "after" ? "How was it?" : "Today"); box.innerHTML = html; G.box = box; G.c = c; wireGuest(box, c, P);
    if (c.scrapbook) { const a = document.createElement("p"); a.className = "dl dl-scrap"; a.innerHTML = `${esc(c.scrapbook.line)} <a class="dl-l" href="${esc(c.scrapbook.link)}">See your year</a>`; G.alt = a; }
    placeGuest();
    new MutationObserver(placeGuest).observe(document.body, { childList: true, subtree: true }); }

  // ---------------------------------------------------------------- Plans
  async function plansPage() { const at = q("#ppSync"); if (!at || q("#dlPlans")) return; const proofs = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!/^encore-rsvp-/.test(k)) continue; const p = proofOf(k.slice(12)); if (p) proofs.push({ id: k.slice(12), ...p }); } } catch {}
    let d = null; try { d = await api("/api/delight/plans", { proofs: proofs.slice(0, 40), keep: true }); } catch { return; }
    if (!d.cards.length && !d.keep) return; css(); const wrap = document.createElement("div"); wrap.id = "dlPlans";
    for (const c of d.cards) { const box = document.createElement("section"); box.className = "dl"; box.innerHTML = cardHtml(c).replace(/(<p class="dl-h"[^>]*>)([^<]*)<\/p>/, (m, a, t) => `${a}<a class="dl-t" href="/e/${encodeURIComponent(c.eventId)}">${t}</a></p>`); wrap.appendChild(box); wireGuest(box, c); }
    if (d.keep) { const box = document.createElement("section"); box.className = "dl"; box.innerHTML = `<p class="dl-k">Keep in touch</p><p>${esc(d.keep.text)}</p><div class="dl-row"><a class="dl-b" href="${esc(d.keep.link)}">Have a look</a><button type="button" class="dl-b" data-dl-keepoff>Turn these off</button></div><p class="dl-msg" aria-live="polite"></p>`;
      q("[data-dl-keepoff]", box).onclick = async () => { try { await api("/api/delight/prefs", { keep: false }, "PUT"); box.innerHTML = `<p class="dl-k">Keep in touch</p><p>Off. No more of these. You can turn them back on in Settings.</p>`; track("keep", "tap", ""); } catch (e) { msg(box, e.message); } };
      wrap.appendChild(box); track("keep", "show", ""); }
    at.before(wrap); }

  // ---------------------------------------------------------------- the host's manage view
  let HV = { id: "", data: null, box: null, busy: false };
  const hvId = () => { const u = new URLSearchParams(location.search).get("open"); let l = ""; try { l = localStorage.getItem("encore.lastEvent") || ""; } catch {} return ID.test(l) ? l : ID.test(u || "") ? u : ""; };
  function hostHtml(d) { const parts = [];
    if (d.checklist) { const C = d.checklist; parts.push(`<p class="dl-k">The hour before</p><p class="dl-h" role="heading" aria-level="2">Starts at ${esc(C.start || "the time on the invite")}</p><p class="dl-s">Tick things off as you go. Nothing here sends anything.</p>
      <ul class="dl-ck">${C.items.map((x) => `<li><button type="button" data-dl-check="${esc(x.id)}" aria-pressed="${!!x.done}"><i>${x.done ? CHECK : ""}</i><span><b>${esc(x.label)}</b><small>${esc(x.sub)}</small></span></button>${x.link ? `<a class="dl-l dl-in" href="${esc(x.link)}" target="_blank" rel="noopener">Open the playlist</a>` : ""}</li>`).join("")}</ul>
      <label class="dl-f" for="dlHostNote">A note for guests on the day <span class="dl-s">(on their morning-of card)</span></label><textarea id="dlHostNote" rows="2" maxlength="280" placeholder="Ring the top buzzer. Shoes off is fine.">${esc(C.note)}</textarea><div class="dl-row"><button type="button" class="dl-b" data-dl-hnote>Save the note</button></div>
      ${d.preview ? `<details><summary>What guests see today</summary>${dayofHtml(d.preview)}</details>` : ""}`); }
    if (d.live && !d.live.noPhotos) parts.push(`${parts.length ? "<hr>" : ""}<p class="dl-k">On now</p><p class="dl-h" role="heading" aria-level="2">Add a photo from tonight</p><p class="dl-s">Guests can add theirs from the invite too. Everything lands in the recap.</p><div class="dl-row"><button type="button" class="dl-b" data-dl-photo>Add a photo</button></div>`);
    if (d.summary) { const S = d.summary; parts.push(`${parts.length ? "<hr>" : ""}<p class="dl-k">The morning after</p><p class="dl-h" role="heading" aria-level="2">${esc(S.line)}</p>${S.quotes.map((x) => `<blockquote><p>${esc(x.text)}</p><cite>${esc(x.name)}</cite></blockquote>`).join("")}
      ${S.notes.length ? `<p class="dl-s" style="margin-top:12px">Private notes, only you see these:</p><ul>${S.notes.map((n) => `<li><b>${esc(n.name)}:</b> ${esc([n.note, n.next ? "Next time: " + n.next : ""].filter(Boolean).join(" · "))}</li>`).join("")}</ul>` : ""}`); }
    if (d.polaroid && (d.polaroid.pool || []).length) { const P = d.polaroid, on = new Set(P.photos.map((x) => x.id));
      parts.push(`<hr><p class="dl-k">Polaroid recap</p><p class="dl-h" role="heading" aria-level="2">${P.status === "posted" ? "Your recap is on the feed" : "Your polaroid recap, ready when you are"}</p><p class="dl-s">${P.status === "posted" ? "Tap a photo to leave it out, then save. You can take it down any time." : "The night's photos with the date on the frame. Tap any to leave it out. Nothing posts until you say so."}</p>
      <div class="dl-pol" role="group" aria-label="Photos in the recap">${P.pool.map((x) => `<button type="button" data-dl-pol="${esc(x.id)}" aria-pressed="${on.has(x.id)}" aria-label="Photo${x.by ? " from " + esc(x.by) : ""}"><img src="${esc(x.url)}" alt="" loading="lazy" decoding="async"><span>${esc(P.stamp)}</span></button>`).join("")}</div>
      <label class="dl-f" for="dlPolCap">A line under it <span class="dl-s">(optional)</span></label><input type="text" id="dlPolCap" maxlength="140" value="${esc(P.caption)}" placeholder="Thank you for a lovely night.">
      <div class="dl-row">${P.status === "posted" ? `<button type="button" class="dl-b" data-dl-polsave>Save changes</button><button type="button" class="dl-b" data-dl-poloff>Take it down</button>` : `<button type="button" class="dl-b" data-dl-polpost>Post the recap</button>`}<a class="dl-b" href="/api/delight/polaroid/${encodeURIComponent(d.eventId)}.png" download="recap.png">Save the image</a></div><p class="dl-msg" aria-live="polite"></p>`); }
    if (d.next) { const N = d.next; if (N.made) parts.push(`<hr><p class="dl-k">The next one</p><p class="dl-h" role="heading" aria-level="2">Made for ${esc(new Date(N.made.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }))}</p><p class="dl-s">It's a draft, so nobody sees it until you share it.</p><div class="dl-row"><a class="dl-b" href="${esc(N.made.href)}">Open it</a></div>`);
      else if (N.already) parts.push(`<hr><p class="dl-k">The next one</p><p>${esc(N.already.title)} is already on for ${esc(new Date(N.already.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }))}.</p><div class="dl-row"><a class="dl-b" href="${esc(N.already.href)}">Open it</a></div>`);
      else if (N.suggestion) { const S = N.suggestion; parts.push(`<hr><p class="dl-k">When's the next one?</p><p>${esc(S.line)}</p><p class="dl-s">${esc(S.why)}</p>
        <label class="dl-f" for="dlNextDate">Date <span class="dl-s" id="dlNextDay">${esc(S.label)}</span></label><input type="date" id="dlNextDate" value="${esc(S.date)}">
        ${N.people.length ? `<p class="dl-f" id="dlPplH">Who to invite <span class="dl-s">(ticked: said they'd come back)</span></p><div class="dl-ppl" role="group" aria-labelledby="dlPplH">${N.people.map((p) => `<button type="button" data-dl-person="${esc(p.key)}" aria-pressed="${p.back || !N.people.some((x) => x.back)}">${esc(p.first)}</button>`).join("")}</div>` : ""}
        <div class="dl-row"><button type="button" class="dl-b" data-dl-next="">Make the next date</button><button type="button" class="dl-b" data-dl-next="${esc(S.repeat)}">Make it a series (${esc(String(S.rhythm || "").toLowerCase())})</button></div><p class="dl-msg" aria-live="polite"></p>`); } }
    return parts.join(""); }
  function wireHost(box, d) { const id = d.eventId;
    qa("[data-dl-check]", box).forEach((b) => b.onclick = async () => { const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(on)); q("i", b).innerHTML = on ? CHECK : ""; track("check", "tap", id); try { await api(`/api/delight/host/${encodeURIComponent(id)}/check`, { item: b.dataset.dlCheck, done: on }, "PUT"); } catch {} });
    const hn = q("[data-dl-hnote]", box); if (hn) hn.onclick = async () => { hn.disabled = true; try { await api(`/api/delight/host/${encodeURIComponent(id)}/note`, { note: q("#dlHostNote", box).value }, "PUT"); hn.textContent = "Saved"; setTimeout(() => { hn.textContent = "Save the note"; }, 1600); } catch {} hn.disabled = false; };
    qa("[data-dl-pol]", box).forEach((b) => b.onclick = () => b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")));
    const polBody = (o) => ({ photos: qa("[data-dl-pol]", box).filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.dataset.dlPol), caption: q("#dlPolCap", box)?.value || "", ...o });
    for (const [sel, o, said] of [["[data-dl-polpost]", { post: true }, "Posted. It leads the recap on the feed now."], ["[data-dl-polsave]", { post: true }, "Saved."], ["[data-dl-poloff]", { unpost: true }, "Taken down. It's a draft again."]]) { const b = q(sel, box); if (b) b.onclick = async () => { b.disabled = true; try { const P = await api(`/api/delight/host/${encodeURIComponent(id)}/polaroid`, polBody(o)); HV.data.polaroid = P; msg(box, said); track("polaroid", "tap", id); setTimeout(() => render(true), 900); } catch (e) { msg(box, e.message); b.disabled = false; } }; }
    qa("[data-dl-person]", box).forEach((b) => b.onclick = () => b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")));
    const nd = q("#dlNextDate", box); if (nd) nd.oninput = () => { const v = nd.value, o = q("#dlNextDay", box); if (o) o.textContent = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : ""; };
    qa("[data-dl-next]", box).forEach((b) => b.onclick = async () => { b.disabled = true; try { const r = await api(`/api/delight/host/${encodeURIComponent(id)}/next`, { date: q("#dlNextDate", box).value, repeat: b.dataset.dlNext, keys: qa("[data-dl-person]", box).filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.dataset.dlPerson) });
      HV.data.next = { made: { id: r.id, date: r.date, href: r.href } }; track("next", "tap", id); render(true); } catch (e) { msg(box, e.message); b.disabled = false; } });
    const ph = q("[data-dl-photo]", box); if (ph) { if (!window.MomentUpload && !document.querySelector('script[src="/momentupload.js"]')) { const s = document.createElement("script"); s.src = "/momentupload.js"; document.head.appendChild(s); }
      ph.onclick = () => window.MomentUpload?.pick({ q: { eventId: id }, max: 6, accept: "image/jpeg,image/png,image/webp,image/gif", onDone: (n) => { if (n) { ph.textContent = `Added ${n}. Add another`; track("live_photo", "tap", id); } } }); }
    for (const m of ["checklist", "summary", "polaroid", "next"]) if (d[m]) track(m, "show", id); }
  function hvAnchor() { const hv = q("#view-studio #hv"); if (!hv || hv.offsetParent === null) return null; const tab = q(".hv-tab[aria-selected=true]", hv); if (tab && !/overview/i.test(tab.textContent)) return null; const pane = q(".hv-pane", hv); if (!pane) return null;
    const after = q("#hvAftH", pane)?.closest("section"); return after ? { el: after, how: "after" } : { el: pane, how: "prepend" }; }
  function render(force) { const at = hvAnchor(); if (!at || !HV.data) return; const html = hostHtml(HV.data); if (!html) { HV.box?.remove(); return; }
    if (!HV.box || force) { const b = document.createElement("section"); b.className = "dl hv-card"; b.setAttribute("aria-label", "During and after"); b.innerHTML = html; HV.box?.remove(); HV.box = b; css(); wireHost(b, HV.data); }
    if (HV.box.isConnected && (at.how === "after" ? HV.box.previousElementSibling === at.el : HV.box.parentNode === at.el)) return;
    if (at.how === "after") at.el.after(HV.box); else at.el.prepend(HV.box); }
  async function hostTick() { const at = hvAnchor(); if (!at) return; const id = hvId(); if (!id) return; if (HV.id !== id) { HV = { id, data: null, box: null, busy: false }; }
    if (!HV.data && !HV.busy) { HV.busy = true; try { HV.data = await api(`/api/delight/host/${encodeURIComponent(id)}`); } catch { HV.data = { eventId: id }; } HV.busy = false; }
    if (HV.id === id) render(false); }

  // ---------------------------------------------------------------- Settings
  async function settingsPage() { const at = q("#notify"); if (!at || q("#dlSet")) return; let d = null; try { d = await api("/api/delight/prefs"); } catch { return; }
    css(); const s = document.createElement("section"); s.id = "dlSet"; s.className = "dl-set"; s.setAttribute("aria-labelledby", "hDl");
    s.innerHTML = `<h2 id="hDl">During and after events</h2><p>Small notes from Potto around the nights you go to and host. Each one is sent once, never at night.</p>${Object.entries(d.labels).map(([k, label]) => `<div class="row"><span>${esc(label)}</span><input type="checkbox" class="sw" data-dl-pref="${esc(k)}" aria-label="${esc(label)}" ${d.prefs[k] ? "checked" : ""}></div>`).join("")}`;
    qa("[data-dl-pref]", s).forEach((x) => x.onchange = async () => { try { await api("/api/delight/prefs", { [x.dataset.dlPref]: x.checked }, "PUT"); } catch { x.checked = !x.checked; } });
    at.after(s); }

  window.PLDelight = { cardHtml, hostHtml };
  const P = location.pathname;
  const start = () => {
    if (/^\/([ei]\/|g$)/.test(P)) { guestPage(); if (P === "/g") addEventListener("hashchange", () => { G = null; guestPage(); }); }
    else if (P === "/plans") plansPage();
    else if (P === "/settings") settingsPage();
    else if (P === "/") { let t = 0; const tick = () => { if (t) return; t = requestAnimationFrame(() => { t = 0; hostTick(); }); }; const v = q("#view-studio") || document.body; new MutationObserver(tick).observe(v, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected", "hidden", "class"] }); addEventListener("hashchange", tick); tick(); }
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();
})();
