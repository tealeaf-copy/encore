// ---- reviews (server/reviews.js has the rules) ----
// Written reviews, next to kudos. One file for every page that shows or takes one:
// - the sheet: "Write a review" (stars when the thing was paid for, a labelled textarea, up to 3 photos, Save)
// - a review as a card: the words (clamped, with a working More), stars where there are some, the guest's first name,
//   what they came to and the month, the host's reply, and the actions that fit the viewer: Report on other people's,
//   Edit on your own, and Reply, Pin and Hide for the host on their own page
// - the host page: reviews join the kudos section (public/kudoswall.js draws the section and calls card() here)
// - a list for the pages of one event, drop or booking, and the entry on the kudos page and the past invite
// Everything is plain DOM and the tokens (--pl-*, --sys-*). Sheets carry aria-modal, so a host's brand kit stays off them.
(function () {
  if (window.EncoreReviews) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = (ym) => { const m = /^(\d{4})-(\d{2})/.exec(String(ym || "")); return m ? `${MON[+m[2] - 1]} ${m[1]}` : ""; };
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const STAR = "M12 3.8l2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.8l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"; // the star team reviews use (public/brandbook.js)
  const star = (on) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" class="rv-st${on ? " on" : ""}"><path d="${STAR}"/></svg>`;
  /** "4 out of 5 stars", drawn. */
  const stars = (n) => { n = Math.max(0, Math.min(5, Math.round(+n || 0))); return n ? `<span class="rv-stars" role="img" aria-label="${n} out of 5 stars">${[1, 2, 3, 4, 5].map((i) => star(i <= n)).join("")}</span>` : ""; };
  /** "4.8 · 12 reviews" from 3 rated reviews, else "12 reviews"; "" when there are none. */
  const countLine = (n, rating) => { n = Math.max(+n || 0, rating?.n || 0); return n ? (rating ? `${(+rating.avg).toFixed(1)} · ` : "") + `${n} ${n === 1 ? "review" : "reviews"}` : ""; };
  const sumHTML = (n, rating) => { const t = countLine(n, rating); return t ? `<span class="rv-sum">${rating ? `<span role="img" aria-label="${(+rating.avg).toFixed(1)} out of 5 stars, from ${rating.n} rated reviews">${star(true)}</span>` : ""}${esc(t)}</span>` : ""; };
  /** The reply proofs this phone holds: [{ id, rid, code }] (the invite keeps them as encore-rsvp-<event>). */
  function proofs() { const P = []; try { for (let i = 0; i < localStorage.length && P.length < 60; i++) { const k = localStorage.key(i); if (!/^encore-rsvp-/.test(k)) continue; const v = JSON.parse(localStorage.getItem(k) || "null"); if (v?.rid && v?.code) P.push({ id: k.slice(12), rid: v.rid, code: v.code }); } } catch {} return P; }
  async function api(url, body) { const r = await fetch(url, body === undefined ? { credentials: "same-origin" } : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.message || "That didn't work. Try again."); e.code = j.code; throw e; } return j; }
  const view = (q) => api("/api/public/reviews/view", { ...q, proofs: proofs() });

  const CSS = `
.rv-stars{display:inline-flex;gap:1px;vertical-align:middle;color:var(--pl-accent-text)}
.rv-st{display:block;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linejoin:round}.rv-st.on{fill:currentColor}
.rv-sum{display:inline-flex;align-items:center;gap:6px;font:600 15px/1.3 var(--sys-sans);color:var(--pl-ink);font-variant-numeric:tabular-nums}.rv-sum>span{display:inline-flex;color:var(--pl-accent-text)}
.rv-top{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:0 0 8px;min-height:20px}
.rv-flag{font:500 13px/1.35 var(--sys-sans);color:var(--pl-soft)}
.rv-card .kd-qw::before{display:none}
.rv-card .kd-q{white-space:pre-line}
.rv-ph{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;border-bottom:var(--pl-bw,1.5px) solid var(--pl-line-strong);background:var(--pl-line-strong)}
.rv-ph img{display:block;width:100%;height:120px;object-fit:cover;background:var(--pl-raised)}
.rv-reply{margin:12px 0 0;padding:10px 12px;background:var(--pl-raised);border-radius:var(--pl-r-md,6px)}
.rv-reply b{display:block;font:600 14px/1.3 var(--sys-sans);color:var(--pl-ink)}.rv-reply p{margin:4px 0 0;font:400 15px/1.5 var(--sys-sans);color:var(--pl-ink);overflow-wrap:anywhere;white-space:pre-line}
.rv-acts{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0}
.rv-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border:var(--pl-bw,1.5px) solid var(--pl-line-strong);border-radius:var(--pl-r-btn,6px);background:var(--pl-surface);color:var(--pl-ink);font:600 16px/1.2 var(--sys-sans);cursor:pointer;text-decoration:none;-webkit-tap-highlight-color:transparent}
.rv-btn.rv-go{background:var(--pl-accent);border-color:var(--pl-accent);color:var(--pl-on-accent,#fff)}
.rv-btn.rv-danger{background:var(--pl-danger,#A2361A);border-color:var(--pl-danger,#A2361A);color:#fff}
.rv-btn:disabled{opacity:.55;cursor:default}
.rv-btn:focus-visible,.rv-link:focus-visible,.rv-sheet :is(textarea,select):focus-visible{outline:3px solid var(--pl-accent);outline-offset:2px}
@media (hover:hover) and (pointer:fine){.rv-btn:not(.rv-go):not(.rv-danger):not(:disabled):hover{background:var(--pl-raised)}}
.rv-link{display:inline-flex;align-items:center;min-height:44px;padding:0 2px;border:0;background:none;color:var(--pl-soft);font:600 15px/1.2 var(--sys-sans);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.rv-write{flex:none}
.kd .kd-head{min-height:44px}
.rv-block{margin:28px 0 8px;text-align:left}
.rv-block h2{margin:0;font:600 24px/1.2 var(--sys-sans);color:var(--pl-ink)}
.rv-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px}
.rv-head>div{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px}
.rv-list{margin-top:14px;display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));align-items:start}
.rv-list .rv-card{display:flex;flex-direction:column;min-width:0;margin:0;overflow:hidden;background:var(--pl-surface);border:var(--pl-bw,1.5px) solid var(--pl-line-strong);border-radius:var(--pl-r-md,6px);color:var(--pl-ink)}
.rv-list .kd-body{display:flex;flex-direction:column;padding:16px 16px 12px}
.rv-list .kd-qw{margin:0;padding:0;border:0}
.rv-list .kd-q{margin:0;font:400 17px/1.5 var(--sys-sans);overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:6;overflow:hidden}
.rv-list .rv-card.is-open .kd-q{display:block;-webkit-line-clamp:unset;overflow:visible}
.rv-list .kd-by{display:flex;align-items:center;gap:10px;margin:12px 0 0;padding-top:12px;border-top:1px dashed var(--pl-line);min-height:44px}
.rv-list .kd-spacer{display:none}
.rv-list .kd-av{flex:none;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--pl-raised);color:var(--pl-accent-text);font:600 15px/1 var(--sys-sans)}
.rv-list .kd-who{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}.rv-list .kd-who b{font:600 15px/1.2 var(--sys-sans)}
.rv-list .kd-who small{font:500 12px/1.3 var(--sys-mono);letter-spacing:.04em;text-transform:uppercase;color:var(--pl-soft);overflow-wrap:anywhere}
.rv-list .kd-more{flex:none;min-height:44px;min-width:44px;padding:0 2px;border:0;background:none;color:var(--pl-accent-text);font:600 15px/1 var(--sys-sans);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.rv-list .kd-more[data-off]{visibility:hidden}.rv-list .kd-more:focus-visible{outline:3px solid var(--pl-accent);outline-offset:2px}
.rv-bg{position:fixed;inset:0;z-index:10000;display:flex;align-items:flex-end;justify-content:center;background:rgba(27,29,28,.5)}
@media (min-width:640px){.rv-bg{align-items:center;padding:24px}}
.rv-sheet{box-sizing:border-box;width:min(520px,100%);max-height:92dvh;overflow:auto;overscroll-behavior:contain;background:var(--pl-surface);color:var(--pl-ink);border-top:1.5px solid var(--pl-ink);border-radius:6px 6px 0 0;padding:20px 16px calc(20px + env(safe-area-inset-bottom,0px));font:400 16px/1.5 var(--sys-sans);text-align:left}
@media (min-width:640px){.rv-sheet{border:1.5px solid var(--pl-ink);border-radius:6px;padding:24px}}
.rv-sheet *{box-sizing:border-box}
.rv-sheet h2{margin:0;font:600 22px/1.2 var(--sys-sans);color:var(--pl-ink)}
.rv-sheet .rv-sub{margin:4px 0 0;color:var(--pl-soft);font-size:15px}
.rv-sheet form{display:grid;gap:14px;margin:16px 0 0}
.rv-sheet label.rv-l,.rv-sheet legend{display:block;padding:0;font:600 16px/1.3 var(--sys-sans);color:var(--pl-ink)}
.rv-sheet .rv-note{margin:2px 0 0;color:var(--pl-soft);font:400 14px/1.45 var(--sys-sans)}
.rv-sheet textarea,.rv-sheet select{display:block;width:100%;margin-top:6px;padding:12px;border:1.5px solid var(--pl-line-strong);border-radius:6px;background:#fff;color:var(--pl-ink);font:400 16px/1.5 var(--sys-sans)}
.rv-sheet textarea:focus,.rv-sheet select:focus{box-shadow:none;border-color:var(--pl-ink)}
.rv-sheet textarea{min-height:132px;resize:vertical}.rv-sheet select{min-height:48px}
.rv-pick{border:0;margin:0;padding:0;min-width:0}
.rv-pick div{display:flex;align-items:center;gap:0;margin:4px 0 0 -8px}
.rv-pick label{position:relative;display:grid;place-items:center;width:44px;height:44px;border-radius:6px;cursor:pointer;color:var(--pl-accent)}
.rv-pick input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.rv-pick svg{width:30px;height:30px}
.rv-pick label:has(input:focus-visible){outline:3px solid var(--pl-accent);outline-offset:-2px}
.rv-pick .rv-say{margin-left:8px;color:var(--pl-soft);font:500 15px/1 var(--sys-sans)}
.rv-count{margin:6px 0 0;color:var(--pl-soft);font:500 14px/1.3 var(--sys-sans);font-variant-numeric:tabular-nums}
.rv-thumbs{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0}.rv-thumbs:empty{display:none}
.rv-thumb{position:relative;width:76px;height:76px;border:1.5px solid var(--pl-line-strong);border-radius:6px;overflow:hidden;background:var(--pl-raised)}
.rv-thumb img{display:block;width:100%;height:100%;object-fit:cover}
.rv-thumb button{position:absolute;top:0;right:0;width:44px;height:44px;border:0;background:none;cursor:pointer;display:grid;place-items:start end;padding:4px}
.rv-thumb button span{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--pl-ink);color:#fff;font:600 14px/1 var(--sys-sans)}
.rv-where{margin:0;padding:10px 12px;background:var(--pl-raised);border-radius:6px;color:var(--pl-ink);font:400 15px/1.45 var(--sys-sans)}
.rv-err{margin:0;color:var(--pl-danger,#A2361A);font:600 15px/1.4 var(--sys-sans)}.rv-err:empty{display:none}
.rv-row{display:flex;flex-wrap:wrap;gap:8px}.rv-row .rv-go,.rv-row .rv-danger{flex:1 1 140px}
.rv-row .rv-end{margin-left:auto}
.rv-sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.rv-toast{position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:10001;max-width:calc(100vw - 32px);padding:10px 16px;border-radius:6px;background:var(--pl-ink);color:#fff;font:600 14px/1.35 var(--sys-sans)}
@media (prefers-reduced-motion:reduce){.rv-sheet,.rv-bg{animation:none!important;transition:none!important}}`;
  function style() { if (document.getElementById("rv-css")) return; const st = document.createElement("style"); st.id = "rv-css"; st.textContent = CSS; (document.head || document.documentElement).appendChild(st); }
  style();
  function toast(t) { const n = document.createElement("div"); n.className = "rv-toast"; n.setAttribute("role", "status"); n.textContent = t; document.body.appendChild(n); setTimeout(() => n.remove(), 3600); }

  // ---------- a review as a card (the host page's kudos section and every list) ----------
  /** r: one review from the server. i, n, row: its place in the host page's row (public/kudoswall.js). o: { owner } */
  function card(r, i = 0, n = 0, row = false, owner = false) { if (owner && !r.own) r = { ...r, own: true }; // the host's own page: their controls are there from the first paint
    const words = String(r.love || "").trim(), name = String(r.name || "").trim() || "A guest", id = "rvq" + String(r.id || i).replace(/[^A-Za-z0-9_-]/g, "");
    const meta = [month(r.month), r.event ? `${r.what || "Came to"} ${r.event}` : ""].filter(Boolean).join(" · "), ph = (r.photos || []).slice(0, 3);
    const av = name === "A guest" ? "" : esc(name.charAt(0).toUpperCase());
    const flag = r.hidden ? (r.own ? "Hidden from your page" : "Hidden by the host. Only you can see it.") : r.pinned ? "Pinned" : r.private ? "Private event. Only guests who were there see this." : "";
    const acts = r.own ? `<button type="button" class="rv-btn" data-rv-act="reply">${r.reply ? "Edit reply" : "Reply"}</button>${r.hidden ? "" : `<button type="button" class="rv-btn" data-rv-act="pin" aria-pressed="${r.pinned ? "true" : "false"}">${r.pinned ? "Unpin" : "Pin"}</button>`}<button type="button" class="rv-btn" data-rv-act="hide">${r.hidden ? "Show on my page" : "Hide"}</button>`
      : r.mine ? `<button type="button" class="rv-btn" data-rv-act="edit">Edit</button>` : "";
    const report = r.mine ? "" : `<button type="button" class="rv-link" data-rv-act="report">Report</button>`;
    return `<figure class="kq kd-card rv-card${ph.length ? " has-photo" : ""}${words ? "" : " no-words"}" data-sf-on="1" data-rv="${esc(r.id)}"${row ? ` role="group" aria-roledescription="slide" aria-label="${i + 1} of ${n}"` : ""}>`
      + (ph.length ? `<div class="rv-ph">${ph.map((p, j) => `<img src="${esc(p.url)}" alt="Photo ${j + 1} from ${esc(name)}'s review" loading="lazy" decoding="async">`).join("")}</div>` : "")
      + `<div class="kd-body">${r.rating || flag ? `<div class="rv-top">${stars(r.rating)}${flag ? `<span class="rv-flag">${esc(flag)}</span>` : ""}</div>` : ""}`
      + (words ? `<blockquote class="kd-qw"><p class="kd-q" id="${id}">${esc(words)}</p></blockquote>` : "")
      + (r.reply ? `<div class="rv-reply"><b>${esc(r.reply.name || "The host")} replied</b><p>${esc(r.reply.text)}</p></div>` : "")
      + `<span class="kd-spacer"></span><figcaption class="kd-by"><span class="kd-av" aria-hidden="true">${av || `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="5.5" r="2.75"/><path d="M2.75 14c.6-2.9 2.7-4.5 5.25-4.5s4.65 1.6 5.25 4.5" stroke-linecap="round"/></svg>`}</span>`
      + `<span class="kd-who"><b>${esc(name)}</b>${meta ? `<small>${esc(meta)}</small>` : ""}</span>`
      + (words ? `<button type="button" class="kd-more" aria-expanded="false" aria-controls="${id}" data-off>More</button>` : "") + `</figcaption>`
      + (acts || report ? `<div class="rv-acts">${acts}${report}</div>` : "") + `</div></figure>`;
  }
  // "More" on the long ones, for lists drawn here (the host page's section wires its own)
  function wireMore(root) { if (!root || root.dataset.rvMore) return; root.dataset.rvMore = "1";
    const check = () => $$(".rv-card", root).forEach((c) => { const q = $(".kd-q", c), b = $(".kd-more", c); if (!q || !b || c.classList.contains("is-open")) return; if (q.scrollHeight > q.clientHeight + 2) b.removeAttribute("data-off"); else b.setAttribute("data-off", ""); });
    root.addEventListener("click", (e) => { const b = e.target.closest(".kd-more"); if (!b) return; const c = b.closest(".rv-card"), open = !c.classList.contains("is-open"); c.classList.toggle("is-open", open); b.setAttribute("aria-expanded", String(open)); b.textContent = open ? "Less" : "More"; });
    check(); let t = 0; addEventListener("resize", () => { clearTimeout(t); t = setTimeout(check, 150); }); document.fonts?.ready?.then(check).catch(() => {}); root._rvCheck = check; }

  // ---------- sheets ----------
  function sheet(html, label) { style(); $$(".rv-toast").forEach((n) => n.remove()); const bg = document.createElement("div"); bg.className = "rv-bg"; bg.innerHTML = `<div class="rv-sheet" role="dialog" aria-modal="true" aria-labelledby="${label}">${html}</div>`;
    const prev = document.activeElement, el = bg.firstChild, scroll = document.documentElement.style.overflow;
    const close = () => { bg.remove(); document.removeEventListener("keydown", key); document.documentElement.style.overflow = scroll; try { prev && prev.focus({ preventScroll: true }); } catch {} };
    const key = (e) => { if (e.key === "Escape") return close(); if (e.key !== "Tab") return; const F = $$("button:not(:disabled),textarea,select,input:not(:disabled),a[href]", el).filter((x) => x.offsetParent !== null || x.type === "radio"); if (!F.length) return;
      const a = F[0], z = F[F.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } };
    bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); }); document.addEventListener("keydown", key); document.documentElement.style.overflow = "hidden"; document.body.appendChild(bg);
    el.addEventListener("click", (e) => { if (e.target.closest("[data-x]")) close(); });
    setTimeout(() => { const h = $("h2", el); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }, 30);
    return { el, close, set: (h) => { el.innerHTML = h; const hd = $("h2", el); if (hd) { hd.tabIndex = -1; hd.focus({ preventScroll: true }); } } }; }
  const SAY = ["", "1 star", "2 stars", "3 stars", "4 stars", "5 stars"];
  const proofOf = (f) => ({ ...(f.rid ? { rid: f.rid, code: f.code } : {}), ...(f.t ? { t: f.t } : {}) });

  /**
   * The form. forms: one or more things this person may review, as the server describes them (GET /api/public/reviews/form,
   * or `write` / `writable` from the view); each may carry its proof ({ rid, code } or { t }). done(review|null, form).
   */
  function write(forms, done) {
    forms = (Array.isArray(forms) ? forms : [forms]).filter((f) => f && f.can !== false); if (!forms.length) return null;
    let f = forms[0], photos = [], busy = false;
    const S = sheet("", "rvT");
    const draw = () => { const m = f.mine, L = f.limits || { min: 20, max: 1200, photos: 3 }; photos = (m?.photos || []).slice(0, L.photos);
      S.set(`<h2 id="rvT">${m ? "Edit your review" : "Write a review"}</h2>
        ${forms.length > 1 ? "" : `<p class="rv-sub">${esc(f.title)}${f.host ? `, with ${esc(f.host)}` : ""}</p>`}
        <form novalidate>
        ${forms.length > 1 ? `<div><label class="rv-l" for="rvWhich">Which one?</label><select id="rvWhich">${forms.map((x, i) => `<option value="${i}"${x === f ? " selected" : ""}>${esc(x.title)}${x.mine ? " (you reviewed this)" : ""}</option>`).join("")}</select></div>` : ""}
        ${f.rated ? `<fieldset class="rv-pick"><legend>Your rating</legend><div>${[1, 2, 3, 4, 5].map((i) => `<label><input type="radio" name="rating" value="${i}"${m?.rating === i ? " checked" : ""} aria-label="${SAY[i]}">${star(false)}</label>`).join("")}<span class="rv-say" id="rvSay" aria-hidden="true"></span></div></fieldset>` : ""}
        <div><label class="rv-l" for="rvText">Your review</label>
          <p class="rv-note" id="rvHint">${f.rated ? "Optional. A rating on its own is fine. " : "In your own words. "}${esc((f.prompts || []).join(" "))}</p>
          <textarea id="rvText" rows="6" maxlength="${L.max}" aria-describedby="rvHint rvCount" autocapitalize="sentences">${esc(m?.text || "")}</textarea>
          <p class="rv-count" id="rvCount" aria-live="polite" hidden></p></div>
        ${f.canPhoto && window.MomentUpload ? `<div><button type="button" class="rv-btn" id="rvAdd">Add photos</button><p class="rv-note">Up to ${L.photos}. They join the photos from the day.</p><div class="rv-thumbs" id="rvThumbs" aria-live="polite"></div></div>` : ""}
        <p class="rv-where">${esc(f.where || "")}</p>
        <p class="rv-err" id="rvErr" role="alert"></p>
        <div class="rv-row"><button type="submit" class="rv-btn rv-go" id="rvSave">Save</button><button type="button" class="rv-btn" data-x>Cancel</button>${m ? `<button type="button" class="rv-link rv-end" id="rvDel">Delete review</button>` : ""}</div>
        </form>`);
      const el = S.el, T = $("#rvText", el), C = $("#rvCount", el), err = $("#rvErr", el);
      const paint = () => { const v = +($("input[name=rating]:checked", el)?.value || 0); $$(".rv-pick label", el).forEach((l, i) => $("svg", l).classList.toggle("on", i < v)); const s = $("#rvSay", el); if (s) s.textContent = v ? `${v} of 5` : ""; };
      $$("input[name=rating]", el).forEach((x) => x.addEventListener("change", () => { paint(); err.textContent = ""; })); paint(); T.addEventListener("input", () => { err.textContent = ""; });
      const count = () => { const left = L.max - T.value.length; C.hidden = left > 200; if (left <= 200) C.textContent = `${left} ${left === 1 ? "character" : "characters"} left`; }; T.addEventListener("input", count); count();
      const sel = $("#rvWhich", el); if (sel) sel.onchange = () => { f = forms[+sel.value] || f; draw(); setTimeout(() => $("#rvWhich", S.el)?.focus(), 0); };
      const thumbs = () => { const box = $("#rvThumbs", el); if (!box) return; box.innerHTML = photos.map((u, i) => `<span class="rv-thumb"><img src="${esc(u)}" alt="Photo ${i + 1}"><button type="button" data-rm="${i}" aria-label="Take photo ${i + 1} off this review"><span aria-hidden="true">×</span></button></span>`).join(""); const add = $("#rvAdd", el); if (add) add.disabled = photos.length >= L.photos; };
      thumbs(); $("#rvThumbs", el)?.addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (!b) return; photos.splice(+b.dataset.rm, 1); thumbs(); });
      const add = $("#rvAdd", el); if (add) add.onclick = () => { const room = L.photos - photos.length; if (room < 1) return; const id = f.subject.split(":")[1];
        window.MomentUpload.pick({ q: { eventId: id, ...(f.rid ? { rid: f.rid, code: f.code } : {}) }, max: room, accept: "image/jpeg,image/png,image/webp", onStart: () => { add.disabled = true; add.textContent = "Adding…"; err.textContent = ""; },
          onEach: (file, r, e2) => { if (r?.url && r.type === "image" && photos.length < L.photos) photos.push(r.url); if (e2) err.textContent = e2.message || "That photo didn't add."; },
          onDone: () => { add.textContent = "Add photos"; thumbs(); } }); };
      $("form", el).onsubmit = async (ev) => { ev.preventDefault(); if (busy) return; const rating = +($("input[name=rating]:checked", el)?.value || 0), text = T.value.trim();
        if (f.rated && !rating) { err.textContent = "Pick a rating, 1 to 5 stars."; $("input[name=rating]", el)?.focus(); return; }
        if (!f.rated && !text) { err.textContent = "Write a few words first."; T.focus(); return; }
        if (text && text.length < L.min) { err.textContent = f.rated ? `Say a little more (at least ${L.min} characters), or leave the words out.` : `Say a little more (at least ${L.min} characters).`; T.focus(); return; }
        busy = true; const b = $("#rvSave", el); b.disabled = true; err.textContent = "";
        try { const j = await api("/api/public/reviews", { subject: f.subject, ...proofOf(f), ...(f.rated ? { rating } : {}), text, photos });
          f.mine = { ...(j.review?.rating ? { rating: j.review.rating } : {}), text, photos: [...photos] };
          S.set(`<h2 id="rvT">Saved</h2><p class="rv-where" style="margin-top:12px">${esc(j.where || f.where || "")} You can change or delete it any time.</p><div class="rv-row" style="margin-top:16px"><button type="button" class="rv-btn rv-go" data-x>Done</button></div>`);
          done?.(j.review, f);
        } catch (e) { err.textContent = e.message; b.disabled = false; } busy = false; };
      const del = $("#rvDel", el); if (del) del.onclick = () => { S.set(`<h2 id="rvT">Delete your review?</h2><p class="rv-sub">It comes off ${esc(f.host ? f.host + "'s" : "the host's")} page for good.</p><p class="rv-err" id="rvErr" role="alert"></p><div class="rv-row" style="margin-top:16px"><button type="button" class="rv-btn rv-danger" id="rvYes">Delete review</button><button type="button" class="rv-btn" id="rvNo">Keep it</button></div>`);
        $("#rvNo", S.el).onclick = draw; $("#rvYes", S.el).onclick = async (e) => { e.currentTarget.disabled = true; try { await api("/api/public/reviews/delete", { subject: f.subject, ...proofOf(f) }); f.mine = null; S.set(`<h2 id="rvT">Review deleted</h2><p class="rv-sub">It's off ${esc(f.host ? f.host + "'s" : "the host's")} page.</p><div class="rv-row" style="margin-top:16px"><button type="button" class="rv-btn rv-go" data-x>Done</button></div>`); done?.(null, f); } catch (x) { $("#rvErr", S.el).textContent = x.message; e.currentTarget.disabled = false; } }; };
    };
    draw(); return S;
  }
  /** Open the form for one subject, asking the server first who this is. proof: { rid, code } | { t } | {}. */
  async function open(subject, proof = {}, done) {
    let f; try { f = await api(`/api/public/reviews/form?subject=${encodeURIComponent(subject)}${proof.rid ? `&rid=${encodeURIComponent(proof.rid)}&code=${encodeURIComponent(proof.code || "")}` : ""}${proof.t ? `&t=${encodeURIComponent(proof.t)}` : ""}`); } catch (e) { f = { can: false, message: e.message }; }
    if (!f.can) { sheet(`<h2 id="rvT">Reviews</h2><p class="rv-sub" style="margin-bottom:16px">${esc(f.message || "You can't review this one.")}</p><div class="rv-row"><button type="button" class="rv-btn" data-x>Close</button></div>`, "rvT"); return null; }
    return write({ ...f, ...proof }, done);
  }

  // ---------- the host's controls and Report, on any card ----------
  function replySheet(r, after) { const S = sheet(`<h2 id="rvT">${r.reply ? "Edit your reply" : `Reply to ${esc(r.name || "this review")}`}</h2>
      <form novalidate><div><label class="rv-l" for="rvReply">Your reply</label><p class="rv-note" id="rvRH">Public, under their review. One reply, up to 400 characters.</p>
      <textarea id="rvReply" rows="4" maxlength="400" aria-describedby="rvRH">${esc(r.reply?.text || "")}</textarea></div><p class="rv-err" id="rvErr" role="alert"></p>
      <div class="rv-row"><button type="submit" class="rv-btn rv-go">Save</button><button type="button" class="rv-btn" data-x>Cancel</button>${r.reply ? `<button type="button" class="rv-link rv-end" id="rvRm">Remove reply</button>` : ""}</div></form>`, "rvT");
    const send = async (text) => { try { const j = await api("/api/host/reviews/" + encodeURIComponent(r.id), { reply: text }); S.close(); after(j); } catch (e) { $("#rvErr", S.el).textContent = e.message; } };
    $("form", S.el).onsubmit = (e) => { e.preventDefault(); const t = $("#rvReply", S.el).value.trim(); if (t.length < 2) { $("#rvErr", S.el).textContent = "Write your reply first."; return; } send(t); };
    const rm = $("#rvRm", S.el); if (rm) rm.onclick = () => send(""); }
  function hideSheet(r, after) { const S = sheet(`<h2 id="rvT">Hide this review?</h2><p class="rv-sub">It comes off your page and every public page. ${esc(r.name && r.name !== "A guest" ? r.name : "The guest")} can still see it, and the Pottery Lab team is told.${r.rating ? " Its star rating still counts toward your average." : ""}</p>
      <p class="rv-err" id="rvErr" role="alert"></p><div class="rv-row" style="margin-top:16px"><button type="button" class="rv-btn rv-go" id="rvYes">Hide review</button><button type="button" class="rv-btn" data-x>Cancel</button></div>`, "rvT");
    $("#rvYes", S.el).onclick = async (e) => { e.currentTarget.disabled = true; try { const j = await api("/api/host/reviews/" + encodeURIComponent(r.id), { hide: true }); S.close(); after(j); } catch (x) { $("#rvErr", S.el).textContent = x.message; e.currentTarget.disabled = false; } }; }
  async function report(r) { try { if (!window.EncoreSafety) await new Promise((ok, no) => { const s = document.createElement("script"); s.src = "/safety.js"; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); window.EncoreSafety.report({ type: "review", text: r.love || "", name: r.name || "" }); } catch { toast("Couldn't open the report form. Try again."); } }
  /** One click handler for a container of cards. get(id) returns the review; refresh() redraws after a change. */
  function wireActs(root, get, refresh) { if (!root || root.dataset.rvActs) return; root.dataset.rvActs = "1";
    root.addEventListener("click", async (e) => { const b = e.target.closest("[data-rv-act]"); if (!b) return; const r = get(b.closest("[data-rv]")?.dataset.rv); if (!r) return; const a = b.dataset.rvAct;
      // the card says what happened (Pinned, Hidden from your page, the reply itself), and the keyboard stays on it
      const back = async () => { await refresh(); setTimeout(() => document.querySelector(`[data-rv="${String(r.id).replace(/[^A-Za-z0-9_-]/g, "")}"] [data-rv-act="${a}"]`)?.focus({ preventScroll: true }), 40); };
      if (a === "report") return report(r);
      if (a === "edit") return open(r.subject, r.proof || proofFor(r.subject), () => refresh());
      if (a === "reply") return replySheet(r, back);
      if (a === "hide") { if (!r.hidden) return hideSheet(r, back); b.disabled = true; try { await api("/api/host/reviews/" + encodeURIComponent(r.id), { hide: false }); await back(); } catch (x) { toast(x.message); b.disabled = false; } return; }
      if (a === "pin") { b.disabled = true; try { await api("/api/host/reviews/" + encodeURIComponent(r.id), { pin: !r.pinned }); await back(); } catch (x) { toast(x.message); b.disabled = false; } } }); }
  const proofFor = (subject) => { const [k, id] = String(subject || "").split(":"); if (k !== "event") return {}; const p = proofs().find((x) => x.id === id); return p ? { rid: p.rid, code: p.code } : {}; };

  // ---------- the host page: the viewer's own view of the kudos section (public/kudoswall.js drew the public one) ----------
  /** S: the strengths the page drew from. o: the same options the page passed to EncoreKudos.mount, plus { handle }. */
  async function host(S, o = {}) {
    if (!window.EncoreKudos) return;
    let V = { reviews: (S && S.reviews) || [] };
    const get = (id) => V.reviews.find((r) => r.id === id), again = async () => { await load(); draw(); };
    const load = async () => { try { V = await view({ host: o.handle }); V.loaded = true; } catch {} };
    wireActs(document.getElementById("kudos"), get, again); // Report works for everyone, signed in or not
    if (!o.handle || !(signedIn() || proofs().length)) return;
    const draw = () => { if (!V.loaded) return; const W = V.writable || [], own = V.owner || W.length || V.reviews.some((r) => r.mine || r.hidden);
      if (!own && V.reviews.length === ((S && S.reviews) || []).length) return; // nothing of theirs here: the page stays as it was drawn
      const wasAll = document.getElementById("kudos")?.classList.contains("is-all");
      let sec = window.EncoreKudos.mount({ ...S, reviews: V.reviews, reviewCount: V.count, rating: V.rating }, o);
      if (!sec && W.length) { const at = document.querySelector("main .s-past") || o.at; if (!at) return; const tpl = document.createElement("template");
        tpl.innerHTML = `<section class="kd kd-few s-kudos" id="kudos" aria-labelledby="kdH"><div class="kd-head"><h2 class="sec" id="kdH">Kudos and reviews</h2></div></section>`; sec = tpl.content.firstElementChild; if (at.classList.contains("s-past")) at.before(sec); else at.prepend(sec); }
      if (!sec) return; if (wasAll) $(".kd-all", sec)?.click();
      const todo = W.filter((x) => !x.mine); // their own reviews carry Edit on the card; the button is for what they haven't reviewed yet
      if (todo.length) { const head = $(".kd-head", sec), b = document.createElement("button"); b.type = "button"; b.className = "rv-btn rv-write"; b.textContent = "Write a review";
        b.onclick = () => write(todo.map((x) => ({ ...x })), again); ($(".kd-ctl", head) || head).prepend(b); }
      wireActs(sec, (id) => { const r = get(id), w = r?.mine ? W.find((x) => x.subject === r.subject) : null; return w ? { ...r, proof: proofOf(w) } : r; }, again); };
    await load(); draw();
  }

  // ---------- one event, drop or booking: its reviews and the way in ----------
  /** el: where it goes. q: { event } | { booking, t } | { host, exp }. o: { title (the heading), empty: draw the way in even with no reviews } */
  async function block(el, q, o = {}) { if (!el) return null; style();
    let V, pre = o.pre; const load = async () => { try { V = await (pre || view(q)); } catch { V = null; } pre = null; };
    const draw = () => { if (!V || (!V.reviews.length && !V.write)) { el.innerHTML = ""; el.hidden = true; return; } el.hidden = false; el.classList.add("rv-block");
      const w = o.entry === false || V.write?.mine ? null : V.write, sum = sumHTML(V.count, V.rating); // their own review carries Edit on its card if (!V.reviews.length && !w) { el.innerHTML = ""; el.hidden = true; return; }
      el.innerHTML = `<div class="rv-head"><div><h2 id="rvH">${esc(o.title || "Reviews")}</h2>${sum}</div>${w ? `<button type="button" class="rv-btn rv-write" id="rvWrite">Write a review</button>` : ""}</div>`
        + (V.reviews.length ? `<div class="rv-list">${V.reviews.map((r, i) => card(r, i, V.reviews.length, false)).join("")}</div>` : `<p class="rv-note" style="margin-top:6px">No reviews yet. Yours would be the first.</p>`);
      const b = $("#rvWrite", el); if (b) b.onclick = () => write({ ...w }, again);
      const list = $(".rv-list", el); if (list) { delete el.dataset.rvMore; wireMore(el); el._rvCheck?.(); } wireActs(el, (id) => { const r = V.reviews.find((x) => x.id === id); return r && V.write && r.mine ? { ...r, proof: proofOf(V.write) } : r; }, again); };
    const again = async () => { await load(); draw(); o.changed?.(V); };
    await load(); draw(); return V; }

  // ---------- the way in, where kudos are asked for ----------
  /** A "Write a review" button for one event, with the reply proof this page holds. Drawn at once; the form checks who it is. */
  function entry(el, id, proof = {}, o = {}) { if (!el || el.querySelector(".rv-write")) return; style(); const b = document.createElement("button"); b.type = "button"; b.className = (o.cls || "rv-btn") + " rv-write"; b.textContent = o.label || "Write a review";
    b.onclick = () => open("event:" + id, proof, (r) => { b.textContent = r ? "Edit your review" : "Write a review"; o.done?.(r); }); el.appendChild(b); return b; }
  // the full invite (/g#rsvp-<id>) after the day: the button sits in the kudos ask, the event's reviews under the page
  function invite() { if (location.pathname !== "/g") return; let last = "";
    const idOf = () => decodeURIComponent((location.hash.match(/^#rsvp-([A-Za-z0-9_-]{2,80})/) || [])[1] || "");
    // asked for with the page, so the reviews are in hand when the invite draws and go in with it (nothing drops in later)
    let pre = null; const ask0 = (id) => { pre = id ? { id, p: view({ event: id }), V: undefined } : null; if (pre) { const me = pre; me.p.then((V) => { me.V = V; go(); }, () => { me.V = null; }); } };
    const go = () => { const id = idOf(), ask = document.getElementById("kudosAsk"), home = document.getElementById("view-guest"); if (!id) return; if (!pre || pre.id !== id) ask0(id);
      const p = proofs().find((x) => x.id === id) || {};
      if (ask && !ask.querySelector(".rv-write") && (p.rid || signedIn()) && !(pre.V && (!pre.V.write || pre.V.write.mine))) { const w = document.createElement("div"); w.className = "rv-entry"; w.style.cssText = "margin-top:4px"; entry(w, id, p.rid ? { rid: p.rid, code: p.code } : {}, { label: pre.V?.write?.mine ? "Edit your review" : "", done: () => { last = ""; document.getElementById("rvEvent")?.remove(); ask0(id); } }); (ask.querySelector(":scope > div") || ask).appendChild(w); }
      if (pre.V && (!pre.V.write || pre.V.write.mine)) ask?.querySelector(".rv-entry")?.remove(); // not theirs to write, or written: their review is under the page, with Edit
      if (pre.V === undefined || !home || !home.children.length || home.hidden || (last === id && document.getElementById("rvEvent"))) return; last = id;
      let box = document.getElementById("rvEvent"); if (!box) { box = document.createElement("section"); box.id = "rvEvent"; box.hidden = true; home.appendChild(box); }
      if (pre.V) block(box, { event: id }, { title: "Reviews", entry: false, pre: Promise.resolve(pre.V) }); };
    const start = () => { go(); new MutationObserver(() => { if (!go.q) { go.q = 1; queueMicrotask(() => { go.q = 0; go(); }); } }).observe(document.body, { childList: true, subtree: true }); addEventListener("hashchange", () => { last = ""; pre = null; document.getElementById("rvEvent")?.remove(); go(); }); };
    if (document.body) start(); else addEventListener("DOMContentLoaded", start); }
  invite();

  window.EncoreReviews = { card, stars, star, countLine, sumHTML, write, open, block, entry, host, proofs, month };
})();
// ---- end reviews ----
