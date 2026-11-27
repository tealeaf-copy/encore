// ---- the conversation on a post page: every comment, one level of replies, the box to add one ----
// Used by public/post.html (/post/e/<id>, /post/r/<id>, /post/m/<id>, /post/c/<handle>/<post id>). The latest three
// comments and a comment box also sit on every feed card (public/feedvisual.js); this is the whole thread. Anyone who
// can see the card can read it, signed in or not; writing needs a sign-in ("Sign in to comment" comes back here). Your
// own comments (and, for a host, any comment on their post) can be deleted; everyone else's carry Report and Block
// (public/safety.js, data-report). "A guest" (someone who keeps their name to themselves) can be reported, not blocked
// by name. Rules live in server/feedcomments.js. window.PLThread.mount(root, data, { onChange }).
(function () {
  if (window.PLThread) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const X_ICON = `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>`;
  const FV = () => window.FeedVisual?.social || null;
  const ago = (t) => FV()?.ago(t) || "", stamp = (t) => FV()?.stamp(t) || "";
  const face = (f) => FV()?.face(f || {}) || "";

  function mount(root, P, { onChange = null } = {}) {
    const target = P.target, signedIn = !!P.canPost, list = root.querySelector("#ppList"), head = root.querySelector("#ppCH"), boxWrap = root.querySelector("#ppBox");
    let L = (P.comments || []).slice(), total = P.count || L.length, max = P.max || 500, reTo = null;
    const summary = () => ({ count: total, last: L.filter((c) => !c.pending).slice(-3).map((c) => ({ ...c, text: String(c.text).replace(/\s+/g, " ").slice(0, 280) })) });
    const row = (c, reply) => `<li class="pp-c${reply ? " re" : ""}${c.pending ? " wait" : ""}" id="c-${esc(c.id)}"${c.mine || c.pending ? "" : ` data-report="${esc(JSON.stringify({ type: "comment", target: "comment:" + c.id, key: c.key || "", name: c.guest ? "" : c.name || "", text: c.text || "" }))}"`}>${face(c.face)}
      <div class="pp-b"><p class="pp-who"><b>${esc(c.mine ? "You" : c.name || "Someone")}</b>${c.host ? `<span class="pp-tag">Host</span>` : ""}${c.pending ? `<span class="pp-at">sending</span>` : `<a class="pp-at" href="#c-${esc(c.id)}"><time datetime="${esc(stamp(c.at))}">${esc(ago(c.at))}</time></a>`}</p>
      <p class="pp-t">${esc(c.text)}</p>${!c.pending && ((signedIn && !reply) || c.canDelete) ? `<p class="pp-do">${signedIn && !reply ? `<button type="button" class="pp-btn" data-reply="${esc(c.id)}">Reply<span class="fb-sr"> to ${esc(c.mine ? "your comment" : c.name || "this comment")}</span></button>` : ""}${c.canDelete ? `<button type="button" class="pp-btn" data-del="${esc(c.id)}">Delete</button>` : ""}</p>` : ""}</div></li>`;
    function draw() { const ids = new Set(L.map((c) => c.id)), kids = new Map(), top = [];
      for (const c of L) { if (c.re && ids.has(c.re)) { if (!kids.has(c.re)) kids.set(c.re, []); kids.get(c.re).push(c); } else top.push(c); }
      list.innerHTML = top.length ? top.map((c) => row(c, false) + (kids.get(c.id)?.length ? `<li class="pp-rs"><ol aria-label="Replies to ${esc(c.mine ? "your comment" : c.name || "this comment")}">${kids.get(c.id).map((k) => row(k, true)).join("")}</ol></li>` : "")).join("")
        : `<li class="pp-empty">No comments yet.</li>`;
      head.innerHTML = `Comments${total ? ` <span class="pp-n">${total}</span>` : ""}`; }
    // the box at the bottom: signed out, a way to sign in that comes back to this page
    boxWrap.innerHTML = signedIn ? `<form class="pp-f" data-pp-box novalidate><p class="pp-re" hidden><span></span><button type="button" class="pp-re-x" aria-label="Stop replying">${X_ICON}</button></p>
        <div class="pp-row">${face(P.me || { g: 1 })}<label class="fb-sr" for="ppText">Add a comment</label><textarea id="ppText" rows="1" maxlength="${max}" placeholder="Add a comment…" enterkeyhint="send" autocomplete="off"></textarea><button class="pp-send" type="submit" disabled>Send</button></div>
        <p class="pp-meta"><span class="pp-err" role="alert"></span><span class="pp-cnt" aria-hidden="true"></span></p></form>`
      : `<div class="pp-f" data-pp-box><a class="pp-in" href="/login?next=${encodeURIComponent(location.pathname)}">Sign in to comment</a></div>`;
    const form = boxWrap.querySelector("form"), ta = boxWrap.querySelector("textarea"), send = boxWrap.querySelector(".pp-send"), err = boxWrap.querySelector(".pp-err"), cnt = boxWrap.querySelector(".pp-cnt"), reEl = boxWrap.querySelector(".pp-re");
    const say = (t) => { if (err) err.textContent = t || ""; };
    const grow = () => { if (!ta) return; ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight + 2) + "px"; const n = [...ta.value].length; send.disabled = !ta.value.trim() || !!form.dataset.busy; cnt.textContent = n > max - 100 ? `${n}/${max}` : ""; };
    function replyTo(id) { const c = L.find((x) => x.id === id); reTo = c ? c.id : null; if (!reEl) return; reEl.hidden = !c; reEl.querySelector("span").textContent = c ? `Replying to ${c.mine ? "your comment" : c.name || "this comment"}` : ""; if (c) { ta.focus({ preventScroll: true }); ta.scrollIntoView({ block: "center" }); } }
    list.addEventListener("click", async (e) => { const r = e.target.closest("[data-reply]"); if (r) { replyTo(r.dataset.reply); return; }
      const b = e.target.closest("[data-del]"); if (!b) return;
      if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = "Delete for good?"; setTimeout(() => { if (b.isConnected) { b.classList.remove("sure"); b.textContent = "Delete"; } }, 4000); return; }
      b.disabled = true; say("");
      try { const r2 = await fetch(`/api/feed/comments/${encodeURIComponent(b.dataset.del)}?target=${encodeURIComponent(target)}`, { method: "DELETE", credentials: "same-origin" }), j = await r2.json().catch(() => ({})); if (!r2.ok) throw new Error(j.message || "That didn't delete. Try again.");
        L = L.filter((c) => c.id !== b.dataset.del); total = j.count ?? L.length; if (reTo === b.dataset.del) replyTo(null); draw(); onChange?.(j.summary || summary()); FV()?.live("Comment deleted."); } catch (er) { b.disabled = false; say(er.message); } });
    if (form) {
      reEl.querySelector(".pp-re-x").onclick = () => { replyTo(null); ta.focus(); };
      ta.addEventListener("input", () => { say(""); grow(); });
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer:fine)").matches) { e.preventDefault(); form.requestSubmit(); } });
      // it shows at once (marked "sending"), then the server's copy takes its place; a failure puts the words back
      form.onsubmit = async (e) => { e.preventDefault(); const text = ta.value.trim(); if (!text || form.dataset.busy) return; form.dataset.busy = 1; say("");
        const re = reTo, tmp = { id: "tmp" + Date.now(), name: "You", mine: true, pending: true, text, at: Date.now(), face: P.me || {}, ...(re ? { re } : {}) };
        L.push(tmp); total++; draw(); ta.value = ""; grow(); replyTo(null); document.getElementById("c-" + tmp.id)?.scrollIntoView({ block: "nearest" });
        try { const r = await fetch("/api/feed/comments", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target, text, ...(re ? { re } : {}) }) }), j = await r.json().catch(() => ({}));
          if (r.status === 401) { location.href = "/login?next=" + encodeURIComponent(location.pathname); return; }
          if (!r.ok || !j.comment) throw new Error(j.message || "That didn't send. Try again.");
          L = L.map((c) => (c.id === tmp.id ? j.comment : c)); total = j.count ?? total; draw(); onChange?.(j.summary || summary()); FV()?.live(re ? "Your reply is posted." : "Your comment is posted."); }
        catch (er) { L = L.filter((c) => c.id !== tmp.id); total = Math.max(0, total - 1); draw(); if (!ta.value) ta.value = text; if (re) replyTo(re); say(er.message); }
        delete form.dataset.busy; grow(); };
    }
    draw();
    // a link to one comment (#c-<id>, from an inbox note or its time): bring it into view and mark it for a moment
    const h = /^#c-([A-Za-z0-9_-]{1,40})$/.exec(location.hash); if (h) { const el = document.getElementById("c-" + h[1]); if (el) { el.classList.add("hl"); el.scrollIntoView({ block: "center" }); setTimeout(() => el.classList.remove("hl"), 2400); } }
    return { focus: () => ta?.focus(), replyTo };
  }
  window.PLThread = { mount };
})();
