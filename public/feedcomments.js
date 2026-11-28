// ---- the conversation on a post page: every comment, replies under the comment they answer, the box to add one ----
// Used by public/post.html (/post/e/<id>, /post/r/<id>, /post/m/<id>, /post/c/<handle>/<post id>). The latest three
// comments and a comment box also sit on every feed card (public/feedvisual.js); this is the whole thread. Anyone who
// can see the card can read it, signed in or not; writing needs a sign-in ("Sign in to comment" comes back here).
// - Replies: one level, drawn indented under their comment with a thin line and smaller faces; a reply to a reply
//   joins the same comment and starts with who it answers ("@Maya"). More than two: the two newest show, and "View 5
//   more replies" opens the rest in place. Reply opens the box right under that comment (public/feedvisual.js
//   openReply: Replying to Maya, Cancel, the cursor in it, kept above the keyboard); the reply shows at once, marked
//   "sending", and a failure leaves it there with Try again.
// - A removed comment whose replies stay reads "Comment removed". Long words wrap; a very long comment has See more.
// - Your own comments (and, for a host, any comment on their post) can be deleted; everyone else's carry Report and
//   Block (public/safety.js, data-report). "A guest" (someone who keeps their name to themselves) can be reported, not
//   blocked by name. The list is an ordered list with the replies as a list inside their comment's item.
// Rules live in server/feedcomments.js. window.PLThread.mount(root, data, { onChange }).
(function () {
  if (window.PLThread) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const FV = () => window.FeedVisual?.social || null;
  const ago = (t) => FV()?.ago(t) || "", stamp = (t) => FV()?.stamp(t) || "";
  const face = (f) => FV()?.face(f || {}) || "";
  const SHOWN = 2; // replies on show before "View more replies"

  function mount(root, P, { onChange = null } = {}) {
    const target = P.target, signedIn = !!P.canPost, list = root.querySelector("#ppList"), head = root.querySelector("#ppCH"), boxWrap = root.querySelector("#ppBox");
    let L = (P.comments || []).slice(), total = P.count || L.filter((c) => !c.gone).length, max = P.max || 500;
    const open = new Set(), wide = new Set(); // threads opened with "View more replies"; long comments opened with "See more"
    const S = () => FV() || {}, RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pid = (c) => c.parent || c.re || "";
    const tree = () => { const ids = new Set(L.map((c) => c.id)), kids = new Map(), top = []; for (const c of L) { const p = pid(c); if (p && ids.has(p)) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(c); } else top.push(c); } return { top, kids }; };
    const topOf = (c) => { const p = pid(c); return p && L.some((x) => x.id === p) ? p : c.id; };
    const whoOf = (c) => (c.gone ? "this thread" : c.mine ? "your comment" : c.guest ? "a guest" : c.name || "this comment");
    const summary = () => { const { top, kids } = tree(); return { count: total, last: top.filter((c) => !c.gone && !c.pending && !c.failed).slice(-3).map((c) => ({ ...c, text: String(c.text).replace(/\s+/g, " ").slice(0, 280), ...(kids.get(c.id)?.length ? { replies: kids.get(c.id).filter((k) => !k.pending && !k.failed).length } : {}) })) }; };
    const long = (c) => !!c.text && ([...c.text].length > 240 || c.text.split("\n").length > 5);
    const words = (c) => (c.text || c.to ? `<p class="pp-t${c.big || S().emojiOnly?.(c.text) ? " big" : ""}${long(c) && !wide.has(c.id) ? " cl" : ""}" id="t-${esc(c.id)}">${S().mention?.(c) || ""}${esc(c.text)}</p>${long(c) ? `<button type="button" class="pp-btn pp-see" data-see="${esc(c.id)}" aria-expanded="${wide.has(c.id)}" aria-controls="t-${esc(c.id)}">${wide.has(c.id) ? "See less" : "See more"}</button>` : ""}` : "");
    const acts = (c, n) => (c.failed ? `<p class="pp-do" role="alert"><span class="pp-fail">${esc(c.failed)}</span><button type="button" class="pp-btn" data-retry="${esc(c.id)}">Try again</button><button type="button" class="pp-btn" data-drop="${esc(c.id)}">Discard</button></p>`
      : !c.pending && (signedIn || c.canDelete) ? `<p class="pp-do">${signedIn ? `<button type="button" class="pp-btn" data-rx-open aria-label="React to ${esc(c.mine ? "your comment" : (c.name || "this person") + "'s comment")}">React</button><button type="button" class="pp-btn" data-reply="${esc(c.id)}" aria-label="Reply to ${esc(whoOf(c))}">Reply</button>` : ""}${c.canDelete ? `<button type="button" class="pp-btn" data-del="${esc(c.id)}" data-n="${n}">Delete</button>` : ""}</p>` : "");
    const row = (c, reply, n = 0) => `<div class="pp-c${reply ? " re" : ""}${c.pending ? " wait" : ""}${c.fresh ? " fx-new" : ""}" id="c-${esc(c.id)}" tabindex="-1"${c.pending || c.failed ? "" : ` data-cid="${esc(c.id)}"`}${c.mine || c.pending || c.failed ? "" : ` data-report="${esc(JSON.stringify({ type: "comment", target: "comment:" + c.id, key: c.key || "", name: c.guest ? "" : c.name || "", text: c.text || (c.gif ? "GIF: " + c.gif.url : c.sticker ? "Sticker: " + c.sticker : "") }))}"`}>${face(c.face)}
      <div class="pp-b"><p class="pp-who"><b>${esc(c.mine ? "You" : c.name || "Someone")}</b>${c.host ? `<span class="pp-tag">Host</span>` : ""}${c.failed ? `<span class="pp-at">not sent</span>` : c.pending ? `<span class="pp-at">sending</span>` : `<a class="pp-at" href="#c-${esc(c.id)}"><time datetime="${esc(stamp(c.at))}">${esc(ago(c.at))}</time></a>`}</p>
      ${words(c)}${S().mediaHtml?.(c) || ""}${S().rxHtml?.(c) || ""}${acts(c, n)}</div></div><div class="pp-slot" data-slot="${esc(c.id)}"></div>`;
    // a comment its writer took back while the replies stay
    const goneRow = (c, n) => `<div class="pp-c gone" id="c-${esc(c.id)}" tabindex="-1">${face({ g: 1 })}<div class="pp-b"><p class="pp-rm">Comment removed</p>${c.canDelete ? `<p class="pp-do"><button type="button" class="pp-btn" data-del="${esc(c.id)}" data-n="${n}" data-gone="1" aria-label="Delete this thread">Delete</button></p>` : ""}</div></div>`;
    const plural = (n) => `${n} more ${n === 1 ? "reply" : "replies"}`;
    function draw() { const { top, kids } = tree(), back = S().holdReply?.(list) || (() => {});
      list.innerHTML = top.length ? top.map((c) => { const K = kids.get(c.id) || [], all = open.has(c.id) || K.length <= SHOWN, shown = all ? K : K.slice(-SHOWN), more = K.length - shown.length;
        return `<li class="pp-th">${c.gone ? goneRow(c, K.length) : row(c, false, K.length)}${K.length ? `<ol class="pp-rs" aria-label="Replies to ${esc(whoOf(c))}">${more ? `<li class="pp-more"><button type="button" class="pp-btn pp-mb" data-more="${esc(c.id)}">View ${plural(more)}</button></li>` : ""}${shown.map((k) => `<li>${row(k, true)}</li>`).join("")}</ol>` : ""}</li>`; }).join("")
        : `<li class="pp-empty">No comments yet.</li>`;
      head.innerHTML = `Comments${total ? ` <span class="pp-n">${total}</span>` : ""}`; window.PLFun?.paint(list);
      // See more only where the words really run past five lines
      for (const b of list.querySelectorAll("[data-see][aria-expanded=false]")) { const p = b.previousElementSibling; if (p && p.scrollHeight <= p.clientHeight + 2) { p.classList.remove("cl"); b.remove(); } }
      back(); }
    const changed = (s) => onChange?.(s || summary());
    // the box at the bottom: signed out, a way to sign in that comes back to this page
    boxWrap.innerHTML = signedIn ? `<form class="pp-f" data-pp-box novalidate>
        <div class="pp-row">${face(P.me || { g: 1 })}<label class="fb-sr" for="ppText">Add a comment</label><textarea id="ppText" rows="1" maxlength="${max}" placeholder="Add a comment…" enterkeyhint="send" autocomplete="off"></textarea>${S().funBtns?.() || ""}<button class="pp-send" type="submit" disabled>Send</button></div>
        <p class="pp-meta"><span class="pp-err" role="alert"></span><span class="pp-cnt" aria-hidden="true"></span></p></form>`
      : `<div class="pp-f" data-pp-box><a class="pp-in" href="/login?next=${encodeURIComponent(location.pathname)}">Sign in to comment</a></div>`;
    const form = boxWrap.querySelector("form"), ta = boxWrap.querySelector("textarea"), send = boxWrap.querySelector(".pp-send"), err = boxWrap.querySelector(".pp-err"), cnt = boxWrap.querySelector(".pp-cnt");
    const say = (t) => { if (err) err.textContent = t || ""; };
    const grow = () => { if (!ta) return; ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight + 2) + "px"; const n = [...ta.value].length; send.disabled = !ta.value.trim() || !!form.dataset.busy; cnt.textContent = n > max - 100 ? `${n}/${max}` : ""; };
    const focusOn = (id) => { try { document.getElementById("c-" + id)?.focus({ preventScroll: true }); } catch {} };
    /** Send one: it is on the page already (tmp, marked "sending"); the server's copy takes its place. Returns the error's words on failure. */
    async function post(tmp, body) {
      try { const r = await fetch("/api/feed/comments", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target, ...body }) }), j = await r.json().catch(() => ({}));
        if (r.status === 401) { location.href = "/login?next=" + encodeURIComponent(location.pathname); return ""; }
        if (!r.ok || !j.comment) throw new Error(j.message || "That didn't send. Try again.");
        const kb = document.activeElement?.id === "c-" + tmp.id; L = L.map((c) => (c.id === tmp.id ? j.comment : c)); total = j.count ?? total; draw(); if (kb) focusOn(j.comment.id); changed(j.summary); FV()?.live(body.parent ? "Your reply is posted." : "Your comment is posted."); return ""; }
      catch (er) { return er.message || "That didn't send. Try again."; } }
    /** A reply to comment c: under c's first comment, at once; a failure stays in place with Try again and Discard. */
    async function reply(c, text) { const top = topOf(c), tmp = { id: "tmp" + Date.now(), name: "You", mine: true, pending: true, fresh: !RM(), text, at: Date.now(), face: P.me || {}, parent: top, ...(top !== c.id && !c.mine ? { to: { name: c.name, guest: c.guest } } : {}), _re: c.id };
      L = L.map((x) => (x.fresh ? { ...x, fresh: false } : x)); L.push(tmp); total++; draw(); focusOn(tmp.id); S().keepInView?.(document.getElementById("c-" + tmp.id));
      const bad = await post(tmp, { text, parent: c.id }); if (!bad) return;
      L = L.map((x) => (x.id === tmp.id ? { ...tmp, pending: false, fresh: false, failed: bad.replace(/ Try again\.$/, "") } : x)); total = Math.max(0, total - 1); draw(); FV()?.live("Your reply didn't send."); }
    list.addEventListener("click", async (e) => {
      const r = e.target.closest("[data-reply]"); if (r) { const c = L.find((x) => x.id === r.dataset.reply); if (c) S().openReply?.(list.querySelector(`[data-slot="${CSS.escape(c.id)}"]`), { who: whoOf(c), opener: r, find: () => list.querySelector(`[data-slot="${CSS.escape(c.id)}"]`), onSend: (text) => reply(c, text) }); return; }
      // the rest of a thread, in place: the older replies open where the button was, and the cursor moves to the first of them
      const m = e.target.closest("[data-more]"); if (m) { const first = (tree().kids.get(m.dataset.more) || [])[0]; open.add(m.dataset.more); draw(); if (first) focusOn(first.id); return; }
      const s = e.target.closest("[data-see]"); if (s) { const id = s.dataset.see; wide.has(id) ? wide.delete(id) : wide.add(id); draw(); list.querySelector(`[data-see="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }); return; }
      const t = e.target.closest("[data-retry],[data-drop]"); if (t) { const id = t.dataset.retry || t.dataset.drop, x = L.find((c) => c.id === id); if (!x) return; L = L.filter((c) => c.id !== id); const to = L.find((c) => c.id === x._re) || L.find((c) => c.id === x.parent);
        if (t.dataset.retry && to) reply(to, x.text); else { draw(); if (to) list.querySelector(`[data-reply="${CSS.escape(to.id)}"]`)?.focus({ preventScroll: true }); } return; }
      const b = e.target.closest("[data-del]"); if (!b) return; const id = b.dataset.del, n = +b.dataset.n || 0, c = L.find((x) => x.id === id), whole = n && b.dataset.gone;
      if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = whole ? `Delete with ${n === 1 ? "its reply" : `its ${n} replies`}?` : n ? "Delete? Replies stay" : "Delete for good?"; setTimeout(() => { if (b.isConnected) { b.classList.remove("sure"); b.textContent = "Delete"; } }, 4000); return; }
      b.disabled = true; say("");
      try { const r2 = await fetch(`/api/feed/comments/${encodeURIComponent(id)}?target=${encodeURIComponent(target)}`, { method: "DELETE", credentials: "same-origin" }), j = await r2.json().catch(() => ({})); if (!r2.ok) throw new Error(j.message || "That didn't delete. Try again.");
        const out = new Set(j.removed || [id]); L = j.kept ? L.map((x) => (x.id === id ? { id, at: x.at, gone: true, ...(P.host ? { canDelete: true } : {}) } : x)) : L.filter((x) => !out.has(x.id)); total = j.count ?? L.filter((x) => !x.gone && !x.failed).length;
        draw(); try { head.focus({ preventScroll: true }); } catch {} changed(j.summary); FV()?.live(j.kept ? "Comment removed. The replies stay." : "Comment deleted."); } catch (er) { b.disabled = false; say(er.message); window.PLToast?.(er.message); } });
    if (form) {
      ta.addEventListener("input", () => { say(""); grow(); });
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer:fine)").matches) { e.preventDefault(); form.requestSubmit(); } });
      // it shows at once (marked "sending"), then the server's copy takes its place; a failure puts the words back
      const submit = async (att = {}) => { const text = ta.value.trim(); if ((!text && !att.gif && !att.sticker) || form.dataset.busy) return; form.dataset.busy = 1; say("");
        const tmp = { id: "tmp" + Date.now(), name: "You", mine: true, pending: true, fresh: !RM(), text, at: Date.now(), face: P.me || {}, ...att };
        L.push(tmp); total++; draw(); ta.value = ""; grow(); document.getElementById("c-" + tmp.id)?.scrollIntoView({ block: "nearest" });
        const bad = await post(tmp, { text, ...att }); if (bad) { L = L.filter((c) => c.id !== tmp.id); total = Math.max(0, total - 1); draw(); if (!ta.value) ta.value = text; say(bad); }
        delete form.dataset.busy; grow(); };
      form.onsubmit = (e) => { e.preventDefault(); submit(); };
      // a GIF or a sticker from the GIF button (public/feedfun.js) goes out at once, with any words already in the box
      form.addEventListener("pl:attach", (e) => submit(e.detail || {}));
    }
    // reactions (public/feedfun.js): the chips under that comment, the new one popping once
    list.dataset.fxTarget = target; list.dataset.fxIn = signedIn ? "1" : "0"; list.setAttribute("aria-label", "Comments"); head.tabIndex = -1;
    document.addEventListener("pl:rx", (e) => { const d = e.detail || {}; if (d.target !== target || !L.some((c) => c.id === d.id)) return;
      L = L.map((c) => ({ ...c, fresh: false, pop: "", ...(c.id === d.id ? { rx: d.reactions, pop: d.pop } : {}) })); draw(); changed(); });
    // a link to one comment or reply (#c-<id>, from an inbox note, a card's "3 replies" or its time): open its thread, bring it into view and mark it for a moment
    const mark = (first) => { const h = /^#c-([A-Za-z0-9_-]{1,40})$/.exec(location.hash), c = h && L.find((x) => x.id === h[1]); if (!c) return false; const t = topOf(c); if (!open.has(t)) { open.add(t); if (!first) draw(); } return c.id; };
    const show = (id) => { const el = id && document.getElementById("c-" + id); if (!el) return; el.classList.add("hl"); el.scrollIntoView({ block: "center" }); setTimeout(() => el.classList.remove("hl"), 2400); };
    const at = mark(true); draw(); show(at);
    window.addEventListener("hashchange", () => show(mark(false)));
    return { focus: () => ta?.focus() };
  }
  window.PLThread = { mount };
})();
