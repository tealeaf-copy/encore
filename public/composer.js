// The "+" on the feed and the sheet it opens. One calm place to start something: a post for your friends (the feed's own
// posts, POST /api/me/posts), a photo or a link, a "Who's in?" ask, and the bigger things as tiles: a new event (the
// app's own New flow), a drop (public/drop.js), photos from an event you were at (public/momentupload.js) and, for hosts
// with a fan club on, an update for members (POST /api/host/club/posts, server/fanclub.js). Tiles come from
// GET /api/me/compose, so each person sees only what fits them. Signed out, the sheet asks you to sign in.
// Drafts stay on this device (localStorage "pl.drafts"): there's no drafts store on the server.
(function () {
  if (window.PLComposer) return;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = () => matchMedia("(pointer: coarse)").matches;
  const G = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const I = {
    plus: `<svg ${G} width="26" height="26"><path d="M12 5v14M5 12h14"/></svg>`,
    photo: `<svg ${G} width="20" height="20"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-5-5-8 8"/></svg>`,
    camera: `<svg ${G} width="20" height="20"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.5-2.2h5.6L16.3 7h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.8" r="3.2"/></svg>`,
    link: `<svg ${G} width="20" height="20"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>`,
    ask: `<svg ${G} width="20" height="20"><circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.7-3.2 2.9-5 5.5-5s4.8 1.8 5.5 5"/><path d="m15.5 11 1.8 1.8 3.4-3.6"/></svg>`,
    event: `<svg ${G} width="22" height="22"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>`,
    drop: `<svg ${G} width="22" height="22"><path d="M5 8.5h14l-1.2 11H6.2zM9 8.5V7a3 3 0 0 1 6 0v1.5"/></svg>`,
    photos: `<svg ${G} width="22" height="22"><rect x="6.5" y="3.5" width="14" height="13" rx="2"/><path d="M3.5 7.5v11a2 2 0 0 0 2 2h11"/><path d="m20.5 13.5-4-4-6 6"/></svg>`,
    club: `<svg ${G} width="22" height="22"><path d="M4 10.5 12 5l8 5.5"/><path d="M6 9.5V19h12V9.5"/><path d="M10 19v-5h4v5"/></svg>`,
    x: `<svg ${G} width="16" height="16"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  };
  const CSS = `
.pc-fab{position:fixed;right:16px;bottom:calc(24px + env(safe-area-inset-bottom));z-index:61;width:56px;height:56px;border-radius:50%;border:0;display:grid;place-items:center;background:var(--pl-accent);color:var(--pl-on-accent,#fff);box-shadow:0 6px 18px rgba(31,26,23,.18),0 1px 3px rgba(31,26,23,.12);cursor:pointer;transition:transform .22s cubic-bezier(.2,.7,.2,1),opacity .22s}
.pc-fab:hover{background:var(--pl-accent-press)}.pc-fab:focus-visible{outline:3px solid var(--pl-ink);outline-offset:3px}
.pc-fab.away{transform:translateY(calc(100% + 40px));opacity:0;pointer-events:none}
body.pc-has-fab main{padding-bottom:88px}
@media (max-width:860px){body.es-has-tabs .pc-fab{bottom:calc(88px + env(safe-area-inset-bottom))}}
.pc-scrim{position:fixed;inset:0;z-index:200;background:rgba(31,26,23,.32);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .2s}
.pc-scrim.on{opacity:1}
.pc-sheet{width:100%;max-width:560px;max-height:calc(100dvh - 24px);display:flex;flex-direction:column;background:var(--pl-surface);color:var(--pl-ink);border-radius:var(--pl-r-lg,6px) var(--pl-r-lg,6px) 0 0;box-shadow:0 -8px 30px rgba(31,26,23,.14);transform:translateY(24px);transition:transform .24s cubic-bezier(.2,.7,.2,1);padding-bottom:env(safe-area-inset-bottom);font:16px/1.45 var(--pl-font-text,"IBM Plex Sans",system-ui)}
.pc-scrim.on .pc-sheet{transform:none}
@media (min-width:700px){.pc-scrim{align-items:center}.pc-sheet{border-radius:var(--pl-r-md,6px)}}
.pc-top{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 8px 0}
.pc-top button,.pc-link{min-height:44px;padding:0 12px;border:0;background:none;color:var(--pl-soft);font:500 15px var(--pl-font-text,"IBM Plex Sans"),system-ui;cursor:pointer;border-radius:999px}
.pc-top button:hover{color:var(--pl-ink);background:var(--pl-raised)}.pc-top .pc-drafts b{font-weight:600;color:var(--pl-ink);margin-left:4px}
.pc-body{overflow-y:auto;padding:4px 20px 12px}
.pc-who{display:flex;align-items:center;gap:10px;margin:8px 0 6px}.pc-who b{font-weight:600}.pc-who small{display:block;color:var(--pl-soft);font-size:13px}
.pc-av{flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;overflow:hidden;background:color-mix(in srgb,var(--c,#D9CCBB) 28%,#fff);font:600 16px var(--pl-font-text,"IBM Plex Sans"),system-ui;color:var(--pl-ink)}.pc-av svg{width:100%;height:100%}
.pc-text{display:block;width:100%;min-height:120px;resize:none;border:0;outline:0;background:none;color:var(--pl-ink);font:400 22px/1.35 var(--sys-title);padding:6px 0}
html body .pc-scrim .pc-sheet textarea.pc-text.pc-text.pc-text,html body .pc-scrim .pc-sheet textarea.pc-text.pc-text.pc-text:focus{border:0!important;box-shadow:none!important;outline:0!important;background:none!important;border-radius:0!important;padding:6px 0!important;min-height:120px!important}.pc-url[hidden],.pc-tools[hidden],.pc-tiles[hidden]{display:none!important}
.pc-text::placeholder{color:var(--pl-muted,#8A7D72)}
.pc-url{display:block;width:100%;min-height:44px;margin:4px 0 8px;padding:0 12px;border:1.5px solid var(--pl-line-strong);border-radius:var(--pl-r-md,6px);background:var(--pl-surface);font:16px var(--pl-font-text,"IBM Plex Sans"),system-ui;color:var(--pl-ink)}
.pc-prev{position:relative;display:inline-block;margin:6px 0 8px}.pc-prev img{display:block;max-height:180px;max-width:100%;border-radius:var(--pl-r-md,6px)}
.pc-prev button{position:absolute;top:6px;right:6px;width:36px;height:36px;border-radius:50%;border:0;background:rgba(31,26,23,.7);color:#fff;display:grid;place-items:center;cursor:pointer}
.pc-chip{display:inline-flex;align-items:center;gap:6px;min-height:32px;margin:4px 0 8px;padding:0 6px 0 12px;border-radius:999px;background:var(--pl-raised);font-size:14px;font-weight:600}
.pc-chip button{width:32px;height:32px;border:0;background:none;display:grid;place-items:center;color:var(--pl-soft);cursor:pointer;border-radius:50%}
.pc-tools{display:flex;align-items:center;gap:2px;padding:8px 12px;border-top:1px solid var(--pl-line)}
.pc-tool{display:inline-grid;place-items:center;width:44px;height:44px;border:0;border-radius:50%;background:none;color:var(--pl-soft);cursor:pointer}.pc-tool:hover,.pc-tool[aria-pressed=true]{color:var(--pl-ink);background:var(--pl-raised)}
.pc-post{margin-left:auto;min-height:44px;padding:0 22px;border:0;border-radius:var(--pl-r-btn,6px);background:var(--pl-accent);color:var(--pl-on-accent,#fff);font:600 15px var(--pl-font-text,"IBM Plex Sans"),system-ui;cursor:pointer}.pc-post:disabled{opacity:.45;cursor:default}
.pc-reuse{display:grid;border-top:1px solid var(--pl-line);background:var(--pl-page);padding:0 12px 12px}.pc-reuse a{display:flex;gap:12px;align-items:center;min-height:52px;padding:8px 4px;color:var(--pl-ink);text-decoration:none;border-bottom:1px dashed var(--pl-line)}.pc-reuse a:last-child{border-bottom:0}.pc-reuse a:focus-visible{outline:3px solid var(--pl-focus,rgba(41,72,154,.3));outline-offset:2px}.pc-reuse b{display:block;font-weight:600;font-size:15px}.pc-reuse small{display:block;color:var(--pl-soft);font-size:14px;line-height:1.35}.pc-reuse svg{flex:none;color:var(--pl-accent-text,var(--pl-accent))}
.pc-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:12px 12px 14px;border-top:1px solid var(--pl-line);background:var(--pl-page)}
.pc-tile{display:flex;align-items:center;gap:10px;min-height:56px;padding:10px 12px;text-wrap:balance;border:1px solid var(--pl-line);border-radius:var(--pl-r-md,6px);background:var(--pl-surface);color:var(--pl-ink);text-decoration:none;text-align:left;font:600 14px/1.25 var(--pl-font-text,"IBM Plex Sans"),system-ui;cursor:pointer}
.pc-tile svg{flex:none;color:var(--pl-accent-text)}.pc-tile:hover{border-color:var(--pl-line-strong)}.pc-tile:only-child{grid-column:1/-1}
.pc-list{list-style:none;margin:0;padding:0}.pc-list li+li{border-top:1px solid var(--pl-line)}
.pc-list button{display:flex;flex-direction:column;align-items:flex-start;width:100%;min-height:56px;padding:10px 4px;border:0;background:none;text-align:left;color:var(--pl-ink);font:15px var(--pl-font-text,"IBM Plex Sans"),system-ui;cursor:pointer}.pc-list small{color:var(--pl-soft);font-size:13px}
.pc-h{margin:8px 0 4px;font:600 20px/1.2 var(--sys-title)}.pc-p{margin:0 0 12px;color:var(--pl-soft);font-size:15px}
.pc-keep{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 16px;border-top:1px solid var(--pl-line);background:var(--pl-raised);font-size:14px}.pc-keep span{flex:1;min-width:140px}
.pc-btn{min-height:44px;padding:0 18px;border-radius:999px;border:1.5px solid var(--pl-line-strong);background:var(--pl-surface);color:var(--pl-ink);font:600 15px var(--pl-font-text,"IBM Plex Sans"),system-ui;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
.pc-btn.go{background:var(--pl-accent);border-color:var(--pl-accent);color:var(--pl-on-accent,#fff)}
.pc-msg{min-height:20px;margin:0;padding:0 20px 6px;color:var(--pl-accent-text);font-size:14px}
@media (prefers-reduced-motion:reduce){.pc-fab,.pc-scrim,.pc-sheet{transition:none!important}.pc-fab.away{transform:none}}
`;
  const DKEY = "pl.drafts";
  const drafts = () => { try { const L = JSON.parse(localStorage.getItem(DKEY) || "[]"); return Array.isArray(L) ? L.filter((d) => d && typeof d.text === "string") : []; } catch { return []; } };
  const saveDrafts = (L) => { try { localStorage.setItem(DKEY, JSON.stringify(L.slice(0, 20))); } catch {} };
  let opts = null, fab = null;
  const getOpts = async () => { if (opts) return opts; try { const r = await fetch("/api/me/compose", { credentials: "same-origin" }); opts = r.ok ? await r.json() : { signedIn: false, tiles: [] }; } catch { opts = { signedIn: false, tiles: [] }; } return opts; };
  const face = (f = {}) => { const c = /^#[0-9a-f]{6}$/i.test(f.color || "") ? f.color : "#D9CCBB"; const art = window.EncoreAvatars && f.art ? window.EncoreAvatars.svg(f.art, c, 40) : ""; return `<span class="pc-av" style="--c:${c}" aria-hidden="true">${art || esc(f.emoji && f.emoji !== "🎉" ? f.emoji : String(f.name || "?").slice(0, 1).toUpperCase())}</span>`; };

  function mount({ onPosted = null } = {}) {
    if (fab) return fab;
    if (!$("#pcCss")) { const st = document.createElement("style"); st.id = "pcCss"; st.textContent = CSS; document.head.appendChild(st); }
    fab = document.createElement("button"); fab.type = "button"; fab.className = "pc-fab"; fab.setAttribute("aria-label", "Create"); fab.innerHTML = I.plus;
    fab.onclick = () => open({ onPosted }); document.body.appendChild(fab); document.body.classList.add("pc-has-fab");
    // hides as you scroll down to read, comes back when you scroll up
    let last = scrollY, tick = false;
    addEventListener("scroll", () => { if (tick) return; tick = true; requestAnimationFrame(() => { const y = scrollY, d = y - last; if (Math.abs(d) > 6) { fab.classList.toggle("away", d > 0 && y > 120); last = y; } tick = false; }); }, { passive: true });
    getOpts();
    return fab;
  }

  function sheet(inner) { const sc = document.createElement("div"); sc.className = "pc-scrim";
    sc.innerHTML = `<div class="pc-sheet" role="dialog" aria-modal="true" aria-label="Create">${inner}</div>`; document.body.appendChild(sc);
    const prevOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = "hidden";
    requestAnimationFrame(() => sc.classList.add("on"));
    sc.close = () => { sc.classList.remove("on"); document.documentElement.style.overflow = prevOverflow; setTimeout(() => sc.remove(), RM() ? 0 : 200); fab?.focus({ preventScroll: true }); };
    sc.addEventListener("click", (e) => { if (e.target === sc) sc.tryClose ? sc.tryClose() : sc.close(); });
    sc.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); sc.tryClose ? sc.tryClose() : sc.close(); }
      if (e.key === "Tab") { const F = [...sc.querySelectorAll("button:not([disabled]),a[href],textarea,input:not([type=file])")].filter((x) => x.offsetParent); if (!F.length) return; const a = F[0], z = F[F.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } } });
    return sc; }

  async function open({ onPosted = null, draft = null } = {}) {
    const O = await getOpts();
    if (!O.signedIn) { const sc = sheet(`<div class="pc-top"><button type="button" data-x>Cancel</button></div><div class="pc-body"><h2 class="pc-h">Sign in to post or host</h2><p class="pc-p">Share what you're up to with friends, start an event or a drop. It takes a minute.</p><p><a class="pc-btn go" href="/login?next=${encodeURIComponent(location.pathname)}">Sign in</a> <a class="pc-btn" href="/signup">Make an account</a></p></div>`);
      sc.querySelector("[data-x]").onclick = sc.close; sc.querySelector("a").focus(); return sc; }
    const st = { text: draft?.text || "", link: draft?.link || "", photo: draft?.photo || "", ask: !!draft?.ask, club: !!draft?.club && !!O.club, id: draft?.id || "" };
    const T = O.tiles || [];
    const tile = (k) => k === "event" ? `<a class="pc-tile" href="/?app=1&new=1#studio" data-tile="event">${I.event}<span>New event</span></a>`
      : k === "drop" ? `<button type="button" class="pc-tile" data-tile="drop">${I.drop}<span>Drop</span></button>`
      : k === "photos" ? `<button type="button" class="pc-tile" data-tile="photos">${I.photos}<span>Event photos</span></button>`
      : k === "club" ? `<button type="button" class="pc-tile" data-tile="club">${I.club}<span>Fan club update</span></button>` : "";
    const nD = drafts().length;
    const sc = sheet(`<div class="pc-top"><button type="button" data-x>Cancel</button><button type="button" class="pc-drafts" data-drafts>Drafts${nD ? `<b>${nD}</b>` : ""}</button></div>
      <div class="pc-body"><div class="pc-who">${face(O.face)}<span><b>${esc(O.name || "You")}</b><small data-aud></small></span></div>
        <label class="fb-sr" for="pcText" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Write a post</label>
        <textarea id="pcText" class="pc-text" maxlength="1000" placeholder="What are you up to?"></textarea>
        <div data-ask></div><div data-prev></div><input class="pc-url" type="url" inputmode="url" placeholder="https://" aria-label="Link" data-url hidden></div>
      <p class="pc-msg" role="status" data-msg></p>
      <div class="pc-tools" role="group" aria-label="Add to your post">
        <button type="button" class="pc-tool" data-photo aria-label="Add a photo">${I.photo}</button>
        ${coarse() ? `<button type="button" class="pc-tool" data-cam aria-label="Take a photo">${I.camera}</button>` : ""}
        <button type="button" class="pc-tool" data-link aria-label="Add a link" aria-pressed="false">${I.link}</button>
        <button type="button" class="pc-tool" data-poll aria-label="Ask who's in" aria-pressed="false">${I.ask}</button>
        <button type="button" class="pc-post" data-post disabled>Post</button>
        <input type="file" accept="image/*" hidden data-file><input type="file" accept="image/*" capture="environment" hidden data-camfile></div>
      ${T.length ? `<div class="pc-tiles" data-tiles>${T.map(tile).join("")}</div>` : ""}
      ${T.includes("event") ? `<nav class="pc-reuse" aria-label="Start from something"><a href="/library/host" data-reuse="library">${I.event}<span><b>Host library</b><small>Your templates, past events, menus and guest lists</small></span></a><a href="/ideas" data-reuse="ideas">${I.ask}<span><b>Ideas to host</b><small>Formats that work, ready to make your own</small></span></a></nav>` : ""}`);
    const q = (s) => sc.querySelector(s), ta = q("#pcText"), msg = (t) => (q("[data-msg]").textContent = t || "");
    const paint = () => { ta.value = st.text; q("[data-aud]").textContent = st.club ? `For ${O.club?.name || "your fan club"} members` : "Your friends see this";
      q("[data-url]").hidden = !st.link && q("[data-link]").getAttribute("aria-pressed") !== "true"; q("[data-url]").value = st.link;
      q("[data-ask]").innerHTML = st.ask ? `<span class="pc-chip">Who's in?<button type="button" aria-label="Remove Who's in">${I.x}</button></span>` : ""; q("[data-ask] button") && (q("[data-ask] button").onclick = () => { st.ask = false; q("[data-poll]").setAttribute("aria-pressed", "false"); paint(); });
      q("[data-prev]").innerHTML = st.photo ? `<span class="pc-prev"><img src="${esc(st.photo)}" alt="Your photo"><button type="button" aria-label="Remove photo">${I.x}</button></span>` : ""; q("[data-prev] button") && (q("[data-prev] button").onclick = () => { st.photo = ""; paint(); });
      q("[data-poll]").hidden = st.club; q("[data-link]").hidden = st.club; q("[data-poll]").setAttribute("aria-pressed", String(st.ask));
      q("[data-post]").textContent = st.club ? "Send to members" : st.ask ? "Ask" : "Post"; ready(); };
    const ready = () => { q("[data-post]").disabled = !(st.text.trim() || st.photo || (!st.club && st.link.trim())); };
    const has = () => !!(st.text.trim() || st.photo || st.link.trim());
    ta.oninput = () => { st.text = ta.value; ready(); }; q("[data-url]").oninput = (e) => { st.link = e.target.value; ready(); };
    q("[data-link]").onclick = (e) => { const on = e.currentTarget.getAttribute("aria-pressed") !== "true"; e.currentTarget.setAttribute("aria-pressed", String(on)); if (!on) st.link = ""; paint(); if (on) q("[data-url]").focus(); };
    q("[data-poll]").onclick = () => { st.ask = !st.ask; paint(); if (st.ask && !st.text.trim()) ta.placeholder = "Dumplings at mine on Friday?"; ta.focus(); };
    const upload = async (f) => { if (!f) return; if (f.size > 8e6) return msg("That photo is over 8 MB."); msg("Adding your photo…");
      try { const r = await fetch("/api/me/posts/photo", { method: "POST", credentials: "same-origin", headers: { "Content-Type": f.type || "image/jpeg" }, body: f }), j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "That photo didn't upload."); st.photo = j.url; msg(""); paint(); } catch (e) { msg(e.message); } };
    q("[data-photo]").onclick = () => q("[data-file]").click(); q("[data-file]").onchange = (e) => upload(e.target.files[0]);
    q("[data-cam]") && (q("[data-cam]").onclick = () => q("[data-camfile]").click()); q("[data-camfile]").onchange = (e) => upload(e.target.files[0]);
    // saving and closing: a half-written post is offered as a draft, never lost silently
    const keepDraft = () => { const L = drafts().filter((d) => d.id !== st.id); L.unshift({ id: st.id || Math.random().toString(36).slice(2, 10), text: st.text, link: st.link, photo: st.photo, ask: st.ask, club: st.club, at: Date.now() }); saveDrafts(L); };
    const dropDraft = () => { if (st.id) saveDrafts(drafts().filter((d) => d.id !== st.id)); };
    sc.tryClose = () => { if (!has() || q(".pc-keep")) return sc.close(); const k = document.createElement("div"); k.className = "pc-keep"; k.innerHTML = `<span>Keep this as a draft?</span><button type="button" class="pc-btn" data-discard>Discard</button><button type="button" class="pc-btn go" data-keep>Save draft</button>`;
      q(".pc-tools").before(k); k.querySelector("[data-keep]").focus(); k.querySelector("[data-keep]").onclick = () => { keepDraft(); sc.close(); }; k.querySelector("[data-discard]").onclick = () => { dropDraft(); sc.close(); }; };
    q("[data-x]").onclick = () => sc.tryClose();
    q("[data-drafts]").onclick = () => { const L = drafts(), body = q(".pc-body");
      body.innerHTML = `<h2 class="pc-h">Drafts</h2>${L.length ? `<ul class="pc-list">${L.map((d, i) => `<li><button type="button" data-d="${i}"><span>${esc(d.text.slice(0, 80) || (d.photo ? "A photo" : d.link || "Empty"))}</span><small>${esc([d.club ? "Fan club" : d.ask ? "Who's in?" : "Post", new Date(d.at || Date.now()).toLocaleDateString("en-US", { month: "short", day: "numeric" })].join(" · "))}</small></button></li>`).join("")}</ul>` : `<p class="pc-p">Nothing saved. Close a post you started and pick Save draft. Drafts stay on this phone.</p>`}`;
      q(".pc-tools").hidden = true; q("[data-tiles]") && (q("[data-tiles]").hidden = true);
      body.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => { const d = L[+b.dataset.d]; sc.close(); setTimeout(() => open({ onPosted, draft: d }), RM() ? 0 : 210); })); };
    q("[data-post]").onclick = async () => { const b = q("[data-post]"); if (b.disabled) return; b.disabled = true; msg("");
      try { const url = st.club ? "/api/host/club/posts" : "/api/me/posts", body = st.club ? { text: st.text.trim(), photo: st.photo } : { text: st.text.trim(), link: st.link.trim(), photo: st.photo, ...(st.ask ? { ask: true } : {}) };
        const r = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message || "That didn't post. Try again.");
        dropDraft(); st.text = st.photo = st.link = ""; sc.close(); window.PLToast?.(st.club ? "Sent to your members." : "Posted. Your friends see it in their feed."); onPosted?.(j.post); }
      catch (e) { msg(e.message); b.disabled = false; } };
    // the bigger things
    sc.querySelectorAll("[data-tile]").forEach((t) => (t.onclick = (e) => { const k = t.dataset.tile;
      if (k === "event") { if (has()) keepDraft(); return; } // a link to the app's own New flow
      e.preventDefault();
      if (k === "club") { st.club = !st.club; if (st.club) st.ask = false; paint(); ta.placeholder = st.club ? "A note for your members" : "What are you up to?"; ta.focus(); return; }
      if (k === "drop") { sc.close(); const go = () => (window.EncoreDrop?.setup ? window.EncoreDrop.setup({}) : (location.href = "/?app=1&new=1#studio")); if (window.EncoreDrop) go(); else { const s = document.createElement("script"); s.src = "/drop.js"; s.onload = go; s.onerror = () => (location.href = "/?app=1&new=1#studio"); document.head.appendChild(s); } return; }
      if (k === "photos") { const body = q(".pc-body"); q(".pc-tools").hidden = true; q("[data-tiles]").hidden = true;
        body.innerHTML = `<h2 class="pc-h">Which one?</h2><p class="pc-p">Photos go on the event's page and into its recap on the feed.</p><ul class="pc-list">${(O.past || []).map((p, i) => `<li><button type="button" data-ev="${i}"><span>${esc(p.title)}</span><small>${esc(new Date(p.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }))}</small></button></li>`).join("")}</ul>`;
        body.querySelectorAll("[data-ev]").forEach((b) => (b.onclick = () => { const ev = O.past[+b.dataset.ev]; sc.close(); if (!window.MomentUpload) { location.href = "/e/" + encodeURIComponent(ev.id); return; }
          window.MomentUpload.pick({ q: { eventId: ev.id }, onDone: (n) => { if (n) { window.PLToast?.(n === 1 ? "Added. It's in the recap." : `${n} added. They're in the recap.`); onPosted?.(null); } } }); }));
        body.querySelector("button")?.focus(); } }));
    paint(); setTimeout(() => ta.focus(), RM() ? 0 : 60);
    return sc;
  }
  window.PLComposer = { mount, open, drafts, _reset: () => { opts = null; } };
})();
