// Per-event looks inside the app (index.html): the full invite (/g) wears the event's look, and hosts get a compact
// "Make it yours" panel in the wizard's Look step and in Edit details. Drawing lives in looks.js, colours in color.js.
// This file reads the app's own globals (draft, saveEvent, uploadCover, safeCover) the way its other add-ons do.
(function () {
  // price tiers ("Adults $55 · Kids $35", public/tiers.js): the sentence reader, Edit details and the full invite's picker
  if (typeof document !== "undefined" && !document.querySelector('script[src="/tiers.js"]')) { const t = document.createElement("script"); t.src = "/tiers.js"; t.defer = true; document.head.appendChild(t); }
  const LK = window.EncoreLooks, C = window.EncoreColor; if (!LK || !C) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const appDraft = () => { try { return typeof draft !== "undefined" ? draft : null; } catch { return null; } }; // eslint-disable-line no-undef
  const appSave = () => { try { if (typeof saveEvent === "function") return saveEvent(true); } catch {} }; // eslint-disable-line no-undef
  const appUpload = (f) => (typeof uploadCover === "function" ? uploadCover(f) : Promise.reject(new Error("Upload isn't ready yet. Try again."))); // eslint-disable-line no-undef
  const tst = (m) => { try { if (typeof toast === "function") toast(m); } catch {} }; // eslint-disable-line no-undef

  // ================= the full invite (/g#rsvp-<id>) =================
  const GCSS = `html body.lk-on #view-guest .in,html body.lk-on #view-guest .in :is(h3,p,small,b,.eyebrow,.ev2-when-time,.gk-row,.gxhosts),html body.lk-on #hostHello,html body.lk-on #hostHello *{color:var(--lk-ink)!important}
html body.lk-on #view-guest .in :is(small,.ev2-when-time,.pp-why,.gxhosts small),html body.lk-on #view-guest .in>p{color:var(--lk-soft)!important}
html body.lk-on #view-guest .in .gk-follow,html body.lk-on #view-guest .in .gk-follow *{color:#1F1A17!important}html body.lk-on #view-guest .in .gk-follow{background:#fff!important}
html body.lk-on #view-guest .in .lk-update,html body.lk-on #view-guest .in .lk-update b,html body.lk-on #view-guest .in .lk-update span{color:#1F1A17!important}html body.lk-on #view-guest .in .lk-update time{color:#5E534B!important}
html body.lk-on #view-guest .in a:not(.btn){color:inherit!important}
html body.lk-on #view-guest.ev2 .invite.gx .in h3.lk-title{font-family:var(--lk-title)!important;font-weight:var(--lk-tw,700)!important;letter-spacing:var(--lk-tls,-.02em)!important;font-size:calc(clamp(40px,5.6vw,72px) * var(--lk-tk,1))!important}
html body.lk-on.lk-vibe-night #view-guest .in h3.lk-title{color:#FFFDF8!important}html body.lk-on.lk-vibe-terminal #view-guest .in h3.lk-title{color:#A6F5BA!important}
html body.lk-on #view-guest :is(.ev2-rs>.stack,#whoGoing,#evFaq){background:#fff!important;color:#1F1A17!important;border-radius:22px!important;padding:20px!important;border:1px solid rgba(0,0,0,.08)!important;box-shadow:0 22px 44px -30px rgba(0,0,0,.5)!important}
html body.lk-on #view-guest.ev2 #gForm{border-top-color:var(--lk-line)!important}
html body.lk-on.lk-on #view-guest #gTopCta,html body.lk-on.lk-on #gBar .btn.primary,html body.lk-on.lk-on #view-guest #g-send,html body.lk-on.lk-on #gStick button.go{background:var(--lk-btn)!important;border-color:var(--lk-btn)!important;color:var(--lk-on-btn)!important}
html body.lk-on #gBar,html body.lk-on #gStick{background:color-mix(in srgb,var(--lk-bot) 92%,transparent)!important;border-top-color:var(--lk-line)!important}html body.lk-on #gBar :is(b,small){color:var(--lk-ink)!important}
html body.lk-on #view-guest .gxcover.lk-pcov{aspect-ratio:auto!important;height:auto!important;min-height:0!important;max-height:none!important;border:0!important;background:none!important;box-shadow:0 22px 44px -22px rgba(0,0,0,.55)!important;border-radius:18px!important}
html body.lk-on #view-guest .gxcover.lk-pcov>*:not(#gCoverImg){display:none!important}html body.lk-on #view-guest .gxcover.lk-pcov #gCoverImg{position:static!important;display:block;width:100%!important;height:auto!important;object-fit:contain!important;inset:auto!important}
html body.lk-on .es-top .es-brand{color:var(--lk-ink)!important}
/* dark and coloured looks: one card style, readable text on every card (owner feedback) */
html body.lk-on #view-guest.ev2 #gForm .ev2-rs,html body.lk-on #view-guest #gForm .ev2-rs{background:transparent!important;box-shadow:none!important;border:0!important;padding:0!important}
html body.lk-on #geBar{background:#fff!important;color:#1F1A17!important;border:1px solid rgba(0,0,0,.08)!important;border-radius:18px!important}html body.lk-on #geBar *{color:#1F1A17!important}
html body.lk-on #view-guest :is(.gk-follow,.ev2-more,.recap){background:#fff!important;color:#1F1A17!important;border:1px solid rgba(0,0,0,.08)!important;border-radius:22px!important;box-shadow:0 22px 44px -30px rgba(0,0,0,.5)!important}
html body.lk-on #view-guest :is(.gk-follow,.ev2-more,.recap) :is(b,small,p,h3,h4,.rail-h,span:not(.gk-av)){color:#1F1A17!important}html body.lk-on #view-guest :is(.gk-follow,.ev2-more) small{color:#665A51!important}html body.lk-on #view-guest :is(.gk-follow,.ev2-more) a{color:#C94A30!important}
html body.lk-on :is(#gBar,#gStick){background:var(--lk-bot)!important;box-shadow:0 -10px 24px -14px rgba(0,0,0,.6)!important}
html body.lk-on #view-guest .gxcover.typed{background:color-mix(in srgb,var(--lk-btn,#C94A30) 22%,#fff)!important}html body.lk-on.lk-fx-lights .es-top{padding-top:46px}
html body.lk-on.lk-fx-lanterns .es-top{padding-top:52px}html body.lk-on.lk-fx-jarwall .es-top{padding-top:132px}@media (min-width:700px){html body.lk-on.lk-fx-jarwall .es-top{padding-top:200px}}
html body.lk-on.lk-fx-jarwall #view-guest .gxcover{box-shadow:0 0 0 2px #FBF4E4,0 24px 60px -18px rgba(122,62,18,.55)!important}html body.lk-on.lk-vibe-pantry #view-guest .in h3.lk-title{color:#3B2414!important}
html body.lk-on #view-guest #menuCard .mc-hv{margin-top:18px}html body.lk-on.lk-fx-lanterns #view-guest .gxcover{box-shadow:0 0 0 2px #F1DFB8,0 24px 60px -18px rgba(242,138,58,.55)!important}
html body.lk-on.lk-fx-lanterns #view-guest #menuCard .mc{margin-top:18px}
html body.lk-on.lk-fx-lanterns #view-guest .mc .mc-c b{color:#1F1A17!important}html body.lk-on.lk-fx-lanterns #view-guest .mc .mc-c small{color:#5A4E45!important}html body.lk-on.lk-fx-lanterns #view-guest .mc .mc-h{color:#B3321F!important}html body.lk-on.lk-fx-lanterns #view-guest .mc .mc-fin b{color:#F4EAD3!important}
html body.lk-on .ev2-chat>p.ev2-foot,html body.lk-on .ev2-chat>p.ev2-foot a{color:var(--lk-ink)!important}`;
  let gSig = "";
  function guest() { const host = document.getElementById("view-guest"), e = window.__gEv;
    if (!host || !e?.id || !host.classList.contains("ev2") || host.hidden || host.offsetParent === null) { if (gSig) { LK.apply(document.body, {}); gSig = ""; } return; }
    const L = LK.lookOf(e); if (!LK.has(L)) return;
    if (!document.getElementById("lk-gcss")) { const s = document.createElement("style"); s.id = "lk-gcss"; s.textContent = GCSS; document.head.appendChild(s); }
    const sig = e.id + JSON.stringify(L); if (sig !== gSig) { gSig = sig; LK.apply(document.body, e); }
    LK.decorate(host, e);
    const inn = host.querySelector(".invite.gx .in"), h3 = inn?.querySelector("h3"); if (h3 && !h3.classList.contains("lk-title")) h3.classList.add("lk-title");
    // the update callout, above the title
    if (inn && L.update?.text && !inn.querySelector(".lk-update")) { const w = document.createElement("div"); w.innerHTML = LK.updateHTML(e); (h3 || inn.firstChild) && inn.insertBefore(w.firstElementChild, inn.querySelector(".eyebrow") || h3); }
    // a poster flyer: whole, with its size reserved
    const cv = host.querySelector(".gxcover"), img = cv?.querySelector("#gCoverImg");
    if (cv && img && LK.safeSrc(e.coverPhoto) && LK.fitOf(L) === "poster") { cv.classList.add("lk-pcov"); if (+L.coverW && !img.getAttribute("width")) { img.setAttribute("width", L.coverW); img.setAttribute("height", L.coverH); img.alt = "Flyer for " + (e.pubTitle || e.name || "the event"); } }
    // the main reply buttons carry the host's emoji and words (the choices in the form keep I'm in / Maybe / Can't go)
    if (!window.__gFull) { const want = LK.buttonText(e, e.rsvpWords?.yes || "I'm in");
      document.querySelectorAll("#gBar .btn.primary,#view-guest #gTopCta,#gStick button.go").forEach((b) => { const t = b.textContent.trim(); if (t !== want && /^(I'm in|Ask to join|Join|RSVP)$/.test(t.replace(/^\S+\s/, (m) => (/[a-z]/i.test(m) ? m : "")))) b.textContent = want; });
      const pill = host.querySelector('.ev2-rsvp [data-go="I\'m in"]'); if (pill && pill.textContent !== want) pill.textContent = want; } }

  // ================= Make it yours =================
  const PCSS = `.mk{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:22px;align-items:start;margin:4px 0 14px;text-align:left}
.mk-l{display:grid;gap:14px;min-width:0}.mk-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mk-h h3{margin:0 auto 0 0;font-size:20px}
.mk-row{display:grid;gap:6px;grid-template-columns:minmax(0,1fr)}.mk-row>b{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#6B5F56}
.mk-chips{display:flex;flex-wrap:wrap;gap:6px}.mk button.mk-c{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:6px 12px;border-radius:999px;border:1px solid #DCCFBE;background:#fff;font:600 14px "Instrument Sans",system-ui,sans-serif;color:#1F1A17}
.mk button.mk-c[aria-pressed=true]{border-color:#1F1A17;box-shadow:inset 0 0 0 1.5px #1F1A17;background:#FFF6E0}.mk button.mk-c:focus-visible{outline:3px solid #C94A30;outline-offset:2px}.mk button.mk-c:disabled{opacity:.45;cursor:not-allowed}
.mk-dots{display:inline-flex}.mk-dots i{width:14px;height:14px;border-radius:50%;border:1.5px solid #fff;margin-left:-5px;box-shadow:0 0 0 1px rgba(0,0,0,.12)}.mk-dots i:first-child{margin-left:0}
.mk button.mk-sw{all:unset;cursor:pointer;width:32px;height:32px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.15)}.mk button.mk-sw[aria-pressed=true]{box-shadow:0 0 0 2px #fff,0 0 0 4px #1F1A17}.mk button.mk-sw:focus-visible{outline:3px solid #C94A30;outline-offset:3px}
.mk-em{display:grid;grid-template-columns:repeat(auto-fill,minmax(38px,1fr));gap:4px;max-width:420px}.mk button.mk-e{all:unset;cursor:pointer;display:grid;place-items:center;height:38px;border-radius:10px;font-size:20px}.mk button.mk-e[aria-pressed=true]{background:#FFF0C2;box-shadow:inset 0 0 0 1.5px #1F1A17}.mk button.mk-e:focus-visible{outline:3px solid #C94A30}
.mk-fly{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.mk-fly img{width:44px;height:56px;object-fit:cover;border-radius:8px;border:1px solid #E4D9C8}.mk-fly label.btn{cursor:pointer}
.mk-upd{display:flex;gap:6px}.mk-upd input{flex:1;min-width:0}
.mk-pv{position:sticky;top:0}.mk-phone{position:relative;height:560px;border-radius:30px;border:8px solid #1F1A17;overflow:hidden;background:#FFF8EE;box-shadow:0 20px 40px -24px rgba(0,0,0,.5)}
.mk-scr{position:absolute;inset:0;overflow:auto;scrollbar-width:none}.mk-in{position:relative;z-index:1;padding:14px 14px 80px;color:var(--lk-ink,#1F1A17)}
.mk-in .lk-update{transform:scale(.86) rotate(-1deg);transform-origin:left top;margin-bottom:4px}.mk-in .mk-cov img{display:block;width:100%;height:auto;border-radius:14px}.mk-in .mk-cov.banner img{aspect-ratio:16/10;object-fit:cover}
.mk-in .mk-cov.none{aspect-ratio:16/10;border-radius:14px;background:color-mix(in srgb,var(--lk-ink,#1F1A17) 10%,transparent)}
.mk-in h1{font:700 calc(30px * var(--lk-tk,1))/1.04 Fredoka,system-ui;margin:14px 0 6px}.mk-in p{margin:2px 0;font-size:13px;color:var(--lk-soft,#5E534B)}
.mk-bar{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:10px 12px;background:color-mix(in srgb,var(--lk-bot,#FFF8EE) 92%,transparent);border-top:1px solid var(--lk-line,#E4D9C8)}
.mk-bar span{display:flex;justify-content:center;align-items:center;min-height:40px;border-radius:999px;background:var(--lk-btn,#C94A30);color:var(--lk-on-btn,#fff);font:600 15px "Instrument Sans",system-ui,sans-serif}
#mkPanel .mk-pvt{display:none!important}
@media (max-width:760px){.mk{grid-template-columns:minmax(0,1fr)}.mk-pv{display:none;order:-1;position:static}.mk.pv-on .mk-pv{display:block}#mkPanel .mk-pvt{display:inline-flex!important}.mk-phone{height:480px;max-width:320px;margin:0 auto}}
.mk-stray{display:flex;flex-wrap:wrap;gap:6px}.mk button.mk-stb{all:unset;cursor:pointer;width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:#FFF8EE;box-shadow:inset 0 0 0 1px #E4D9C8;transition:transform .15s}
.mk button.mk-stb svg{width:32px;height:32px}.mk button.mk-stb:hover{transform:rotate(-6deg) scale(1.08)}.mk button.mk-stb:focus-visible{outline:3px solid #C94A30;outline-offset:2px}.mk button.mk-stb:disabled{opacity:.4;cursor:not-allowed;transform:none}
.mk-in .mk-cov.art{position:relative;aspect-ratio:16/10;border-radius:14px;overflow:hidden;border:2px solid var(--lk-ink,#1F1A17)}.mk-in .mk-cov{position:relative}
.mk-phone.lk-fx-lanterns .mk-in,.mk-phone.lk-fx-lights .mk-in{padding-top:52px}.mk-phone.lk-fx-jarwall .mk-in{padding-top:88px}.mk-phone.peek{outline:3px dashed #C94A30;outline-offset:4px}.mk-roll{margin:8px 0 0;min-height:20px;text-align:center;font:600 13px "Instrument Sans",system-ui,sans-serif;color:#6B5F56}
.mk-sur.roll{animation:mk-roll .5s ease}@keyframes mk-roll{0%{transform:rotate(0)}30%{transform:rotate(-14deg) scale(1.08)}60%{transform:rotate(10deg)}100%{transform:rotate(0)}}
@media (prefers-reduced-motion:reduce){.mk-sur.roll{animation:none}}
#wizBg .wiz:has(#mkPanel){width:min(1000px,96vw)!important;max-width:min(1000px,96vw)!important}
#wizBg .wiz-body:has(#mkPanel) #covField>.cov-row,#wizBg .wiz-body:has(#mkPanel) #covField>small.note,.fedit:has(#mkPanel) #covField>.cov-row,.fedit:has(#mkPanel) #covField>small.note{display:none}`;
  const pcss = () => { if (document.getElementById("lk-pcss")) return; const s = document.createElement("style"); s.id = "lk-pcss"; s.textContent = PCSS; document.head.appendChild(s); };
  const dots = (p) => `<span class="mk-dots" aria-hidden="true">${p.map((c) => `<i style="background:${esc(c)}"></i>`).join("")}</span>`;
  const same = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
  const flyerPal = new Map();
  const clock = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); if (!m) return ""; const h = +m[1]; return `${h % 12 || 12}${m[2] === "00" ? "" : ":" + m[2]}${h >= 12 ? "pm" : "am"}`; }; // coverPhoto url -> palette read from it

  function panelHTML(d) { const L = LK.lookOf(d), u = LK.safeSrc(d.coverPhoto), fp = flyerPal.get(u), ask = !!d.approvalRequired, fit = LK.fitOf(L), pal = L.palette || [];
    const chip = (attr, v, on, inner, extra = "") => `<button type="button" class="mk-c" ${attr}="${esc(v)}" aria-pressed="${!!on}"${extra}>${inner}</button>`;
    return `<section class="mk" id="mkPanel" aria-label="Make it yours"><div class="mk-l">
      <div class="mk-h"><h3>Make it yours</h3><button type="button" class="btn sm mk-sur" id="mkSur">🎲 Surprise me</button><button type="button" class="btn sm mk-pvt" id="mkPvT" aria-expanded="false">Preview</button></div>
      <div class="mk-row"><b>Vibes</b><div class="mk-chips">${Object.entries(LK.VIBES).map(([k, v]) => chip("data-vibe", k, L.vibe === k, `${dots(v.look.palette)} ${esc(v.label)}`)).join("")}</div></div>
      <div class="mk-row"><b>Flyer</b><div class="mk-fly">${u ? `<img src="${esc(u)}" alt="Your flyer" loading="lazy">` : ""}<label class="btn sm">${u ? "Change flyer" : "Upload flyer"}<input type="file" accept="image/png,image/jpeg,image/webp" id="mkFile" hidden></label>
        ${u ? `${chip("data-fit", "poster", fit === "poster", "Whole flyer")}${chip("data-fit", "banner", fit === "banner", "Banner")}<button type="button" class="linkbtn" id="mkRm">Remove</button>` : `<small class="note">A poster or photo. Tall ones show whole.</small>`}</div></div>
      <div class="mk-row"><b>Colors</b><div class="mk-chips">${u ? chip("data-col", "flyer", fp && same(pal, fp), `${fp ? dots(fp) : ""} From flyer`) + chip("data-col", "contrast", fp && pal[0] === C.contrastPage(fp[0]), "Contrast") : ""}
        ${LK.SWATCHES.map(([h, a1, a2, n]) => `<button type="button" class="mk-sw" data-sw="${h}" style="background:${h}" aria-label="${esc(n)}" title="${esc(n)}" aria-pressed="${pal[0] === h && pal[1] === a1}"></button>`).join("")}${chip("data-col", "none", !pal.length, "None")}</div></div>
      <div class="mk-row"><b>Cover</b><div class="mk-chips">${chip("data-cs", "", L.coverStyle !== "deck", "House")}${chip("data-cs", "deck", L.coverStyle === "deck", "🃏 Card deck", u ? ` disabled title="For drawn covers. Remove the flyer to use it."` : "")}</div>${u ? `<small class="note">Card deck is for drawn covers, without a flyer.</small>` : ""}</div>
      <div class="mk-row"><b>Menu</b><div class="mk-chips">${chip("data-ms", "", L.menuStyle !== "harvest", "House")}${chip("data-ms", "harvest", L.menuStyle === "harvest", "🍂 Harvest card")}</div>${(d.courses || []).length ? "" : `<small class="note">For the menu on your invite, once it has courses.</small>`}</div>
      <div class="mk-row"><b>Stickers</b><div class="mk-stray" role="group" aria-label="Add a sticker">${Object.entries(LK.STICKERS).map(([k, v]) => `<button type="button" class="mk-stb" data-st="${k}" aria-label="Add ${esc(v.label.toLowerCase())} sticker" title="${esc(v.label)}"${(L.stickers || []).length >= LK.MAX_STICKERS ? " disabled" : ""}>${LK.stickerSVG(k)}</button>`).join("")}</div>
        <small class="note">${(L.stickers || []).length ? `${(L.stickers || []).length} of ${LK.MAX_STICKERS} on your cover. Drag them around in the preview, double-tap one to take it off. <button type="button" class="linkbtn" id="mkStShuf">Shuffle</button> · <button type="button" class="linkbtn" id="mkStX">Clear</button>` : `Tap one to put it on your cover, up to ${LK.MAX_STICKERS}.`}</small></div>
      <div class="mk-row"><b>Effect</b><div class="mk-chips">${LK.EFFECTS.map(([k, l]) => chip("data-fx", k, (L.effect || "none") === k, esc(l))).join("")}${chip("data-lights", "1", !!L.lights, "💡 String lights")}</div></div>
      <div class="mk-row"><b>Title font</b><div class="mk-chips">${chip("data-font", "", !L.titleFont, "House")}${Object.entries(LK.FONTS).map(([k, F]) => chip("data-font", k, L.titleFont === k, `<span style="font-family:${esc(F.css)};font-weight:${F.w}">Aa</span> ${esc(F.label)}`)).join("")}</div></div>
      <div class="mk-row"><b>Button</b><div class="mk-chips">${LK.LABELS.filter((x) => (ask ? x === "Ask to join" : x !== "Ask to join")).map((x) => chip("data-lbl", x, ask || (L.buttonLabel || "I'm in") === x, esc(x))).join("")}</div>${ask ? `<small class="note">You let each guest in, so the button says Ask to join.</small>` : ""}
        <div class="mk-em" role="group" aria-label="Button emoji"><button type="button" class="mk-e" data-em="" aria-pressed="${!L.buttonEmoji}" aria-label="No emoji">∅</button>${LK.EMOJI.map((x) => `<button type="button" class="mk-e" data-em="${x}" aria-pressed="${L.buttonEmoji === x}">${x}</button>`).join("")}</div></div>
      <div class="mk-row"><b>Update</b><div class="mk-upd"><input type="text" id="mkUpd" maxlength="80" placeholder="Moved to the back room this year" value="${esc(L.update?.text || "")}"><button type="button" class="btn sm" id="mkUpdGo">${L.update?.text ? "Change" : "Post"}</button>${L.update?.text ? `<button type="button" class="linkbtn" id="mkUpdX">Clear</button>` : ""}</div><small class="note">Shows at the top of the invite, with the time you posted it.</small></div>
    </div><div class="mk-pv" aria-label="Preview"><div class="mk-phone"><div class="mk-scr"><div class="mk-in"></div></div></div><p class="mk-roll" aria-live="polite"></p></div></section>`; }

  function preview(box, d) { const ph = box.querySelector(".mk-phone"), inn = box.querySelector(".mk-in"); if (!ph || !inn) return; const L = LK.lookOf(d), u = LK.safeSrc(d.coverPhoto), fit = LK.fitOf(L);
    const when = d.date ? new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "Date to pick";
    inn.innerHTML = `${LK.updateHTML(d)}<div class="mk-cov ${u ? fit : window.EventArt ? "art" : "none"}">${u ? LK.coverHTML(d, { lazy: true }) : window.EventArt ? window.EventArt.cover({ ...d, title: d.pubTitle || d.name }, { title: "", label: "" }) : ""}</div><h1 class="lk-title">${esc(d.pubTitle || d.name || "Your event")}</h1><p><b>${esc(when)}${d.startTime ? " · " + esc(clock(d.startTime)) : ""}</b></p><p>📍 ${esc(d.meetPoint || d.venueName || d.city || "Where it is")}</p>`;
    let bar = ph.querySelector(".mk-bar"); if (!bar) { bar = document.createElement("div"); bar.className = "mk-bar"; ph.appendChild(bar); } bar.innerHTML = `<span>${esc(LK.buttonText(d, d.rsvpWords?.yes || "I'm in"))}</span>`;
    LK.apply(ph, d, { fixed: false }); if (!LK.has(L)) ph.style.background = ""; }

  // what a chip would do, as a new look (used for the click and for the live preview on hover or focus)
  function nextLook(b, L, d) {
    if (b.dataset.vibe) { const v = LK.VIBES[b.dataset.vibe].look, n = { ...L, ...v, vibe: b.dataset.vibe }; if (!v.lights) delete n.lights; if (!v.coverStyle) delete n.coverStyle; if (!v.menuStyle) delete n.menuStyle; if (d.approvalRequired) n.buttonLabel = "Ask to join"; if (v.effect === "none") delete n.effect; return n; }
    const put = (patch) => { const n = { ...L, ...patch }; if (!("vibe" in patch) && ("palette" in patch || "effect" in patch || "titleFont" in patch)) delete n.vibe; for (const k of Object.keys(n)) if (n[k] === undefined) delete n[k]; return n; };
    if (b.dataset.sw) { const s = LK.SWATCHES.find((x) => x[0] === b.dataset.sw); return put({ palette: s.slice(0, 3) }); }
    if (b.dataset.fx) return put({ effect: b.dataset.fx === "none" ? undefined : b.dataset.fx });
    if ("font" in b.dataset) return put({ titleFont: b.dataset.font || undefined });
    if ("em" in b.dataset) return put({ buttonEmoji: b.dataset.em || undefined });
    if (b.dataset.lbl) return put({ buttonLabel: b.dataset.lbl });
    if (b.dataset.lights) return put({ lights: L.lights ? undefined : true });
    if ("cs" in b.dataset) return put({ coverStyle: b.dataset.cs || undefined });
    if ("ms" in b.dataset) return put({ menuStyle: b.dataset.ms || undefined });
    if (b.dataset.st) { const st = LK.cleanStickers(L.stickers); if (st.length >= LK.MAX_STICKERS) return null; return put({ stickers: [...st, spot(b.dataset.st, st)] }); }
    return null; }
  // a new sticker lands somewhere free on the cover: round the edges, away from the others, at a little tilt
  function spot(id, st) { let best = null;
    for (let i = 0; i < 12; i++) { const c = { id, x: Math.round(12 + Math.random() * 76), y: Math.round(14 + Math.random() * 72), s: Math.round((0.85 + Math.random() * 0.35) * 10) / 10, r: Math.round(-18 + Math.random() * 36) };
      const far = Math.min(99, ...st.map((o) => Math.hypot(o.x - c.x, o.y - c.y))); if (!best || far > best.far) best = { c, far }; }
    return best.c; }
  const shuffle = (st) => st.reduce((out, x) => [...out, { ...spot(x.id, out), s: x.s }], []);
  // what Surprise me rolled, in words
  const rolled = (L) => { const sw = LK.SWATCHES.find((x) => x[0] === (L.palette || [])[0]), v = LK.VIBES[L.vibe], fx = LK.EFFECTS.find(([k]) => k === (L.effect || "none")), F = LK.FONTS[L.titleFont];
    return [v ? v.label : sw ? sw[3] : "Your colors", fx && fx[0] !== "none" ? fx[1] : "", F ? F.label + " title" : "", L.buttonEmoji || ""].filter(Boolean).join(" · "); };
  // drag a sticker on the preview's cover; a double-tap takes it off
  function stickerDrag(box, d, onDone) { const layer = box.querySelector(".mk-in .mk-cov .lk-stk"); if (!layer) return; layer.classList.add("edit");
    let drag = null, lastTap = { i: -1, t: 0 };
    layer.onpointerdown = (ev) => { const el = ev.target.closest(".lk-st"); if (!el) return; ev.preventDefault(); const i = +el.dataset.i, now = performance.now();
      if (lastTap.i === i && now - lastTap.t < 350) { const st = LK.cleanStickers(LK.lookOf(d).stickers); st.splice(i, 1); lastTap = { i: -1, t: 0 }; return onDone(st, "Sticker off."); }
      lastTap = { i, t: now }; drag = { el, i, r: layer.getBoundingClientRect(), moved: false }; el.classList.add("drag"); el.setPointerCapture?.(ev.pointerId); };
    layer.onpointermove = (ev) => { if (!drag) return; const x = Math.min(94, Math.max(6, ((ev.clientX - drag.r.left) / drag.r.width) * 100)), y = Math.min(92, Math.max(8, ((ev.clientY - drag.r.top) / drag.r.height) * 100)); // kept on the cover
      drag.moved = true; drag.x = Math.round(x * 10) / 10; drag.y = Math.round(y * 10) / 10; drag.el.style.left = drag.x + "%"; drag.el.style.top = drag.y + "%"; };
    const up = () => { if (!drag) return; const g = drag; drag = null; g.el.classList.remove("drag"); if (!g.moved) return; const st = LK.cleanStickers(LK.lookOf(d).stickers); if (st[g.i]) { st[g.i] = { ...st[g.i], x: g.x, y: g.y }; onDone(st); } };
    layer.onpointerup = up; layer.onpointercancel = up; }

  async function flyerPalette(u) { if (!u) return null; if (flyerPal.has(u)) return flyerPal.get(u); try { const r = await LK.readImage(u); flyerPal.set(u, r.palette); return r.palette; } catch { return null; } }

  function mount(box, d, save) { pcss(); Object.keys(LK.FONTS).forEach((k) => LK.loadFont(k)); /* the font chips show in their own fonts */ box.innerHTML = panelHTML(d); preview(box, d);
    let t = 0, roll = ""; const commit = (msg) => { d.look = { ...LK.lookOf(d) }; for (const k of Object.keys(d.look)) if (d.look[k] == null || d.look[k] === "") delete d.look[k];
      clearTimeout(t); t = setTimeout(() => { Promise.resolve(save()).catch(() => tst("That didn't save. Try again.")); }, 500); const pvOn = box.querySelector("#mkPanel")?.classList.contains("pv-on"); box.innerHTML = panelHTML(d); if (pvOn) openPv(); preview(box, d); wire(); if (msg) tst(msg); };
    const openPv = () => { const P2 = box.querySelector("#mkPanel"), pv = box.querySelector("#mkPvT"); if (!P2 || !pv) return; P2.classList.add("pv-on"); pv.setAttribute("aria-expanded", "true"); pv.textContent = "Hide preview"; };
    const small = () => matchMedia("(max-width:760px)").matches;
    const set = (patch, msg) => { d.look = { ...LK.lookOf(d), ...patch }; if ("palette" in patch || "effect" in patch || "titleFont" in patch) if (!("vibe" in patch)) delete d.look.vibe; commit(msg); };
    function wire() { const P2 = box.querySelector("#mkPanel"); const pv = box.querySelector("#mkPvT"), ph = box.querySelector(".mk-phone");
      stickerDrag(box, d, (st, msg) => { d.look = { ...LK.lookOf(d), stickers: st }; if (!st.length) delete d.look.stickers; commit(msg); });
      if (roll) { const r = box.querySelector(".mk-roll"); if (r) r.textContent = "Rolled: " + roll; box.querySelector("#mkSur")?.classList.add("roll"); roll = ""; }
      // live preview: hover or focus a choice and the phone shows it; leave and it goes back to what's picked
      let peek = null; const show = (b) => { if (b === peek) return; peek = b; const n = b ? nextLook(b, LK.lookOf(d), d) : null; ph?.classList.toggle("peek", !!n); preview(box, n ? { ...d, look: n } : d); if (!n) wire2(); };
      const wire2 = () => stickerDrag(box, d, (st, msg) => { d.look = { ...LK.lookOf(d), stickers: st }; if (!st.length) delete d.look.stickers; commit(msg); });
      const peekable = (el) => { const b = el?.closest?.("button"); return b && P2.contains(b) && !b.disabled && !b.dataset.st && nextLook(b, LK.lookOf(d), d) ? b : null; };
      P2.querySelector(".mk-l").onpointerover = (ev) => { if (ev.pointerType === "mouse") show(peekable(ev.target)); };
      P2.querySelector(".mk-l").onpointerleave = () => show(null);
      P2.querySelector(".mk-l").onfocusin = (ev) => { if (ev.target.matches(":focus-visible")) show(peekable(ev.target)); };
      P2.querySelector(".mk-l").onfocusout = (ev) => { if (!P2.querySelector(".mk-l").contains(ev.relatedTarget)) show(null); };
      if (pv) pv.onclick = () => { const on = !P2.classList.contains("pv-on"); P2.classList.toggle("pv-on", on); pv.setAttribute("aria-expanded", on); pv.textContent = on ? "Hide preview" : "Preview"; };
      P2.onclick = async (ev) => { const b = ev.target.closest("button"); if (!b || b.id === "mkPvT") return; const L = LK.lookOf(d), u = LK.safeSrc(d.coverPhoto);
        if (b.id === "mkSur") { const fp = u ? await flyerPalette(u) : null; const n = LK.surprise(d, { keepPalette: fp, avoid: L.vibe }); d.look = { ...L, ...n, lights: !!n.lights }; if (!n.vibe) delete d.look.vibe; if (!n.lights) delete d.look.lights; if (!n.coverStyle || u) delete d.look.coverStyle; if (!n.menuStyle) delete d.look.menuStyle; if (n.effect === "none") delete d.look.effect;
          roll = rolled(d.look); if (small()) openPv(); return commit(); }
        if (b.dataset.st) { const n = nextLook(b, L, d); if (!n) return tst(`That's ${LK.MAX_STICKERS} stickers. Take one off to add another.`); d.look = n; if (small()) openPv(); commit(); const last = box.querySelector(".mk-in .lk-st:last-child"); last?.classList.add("lk-pop"); return; }
        if (b.id === "mkStX") { const n = { ...L }; delete n.stickers; d.look = n; return commit("Stickers off."); }
        if (b.id === "mkStShuf") { d.look = { ...L, stickers: shuffle(LK.cleanStickers(L.stickers)) }; return commit(); }
        if ("cs" in b.dataset) { d.look = nextLook(b, L, d); return commit(); }
        if ("ms" in b.dataset) { d.look = nextLook(b, L, d); return commit(); }
        if (b.dataset.vibe) { d.look = nextLook(b, L, d); return commit(); }
        if (b.dataset.fit) return set({ coverFit: b.dataset.fit });
        if (b.id === "mkRm") { d.coverPhoto = ""; const n = { ...L }; delete n.coverW; delete n.coverH; delete n.coverFit; d.look = n; return commit("Flyer removed."); }
        if (b.dataset.col === "none") return set({ palette: undefined });
        if (b.dataset.col === "flyer" || b.dataset.col === "contrast") { const fp = await flyerPalette(u); if (!fp?.length) return tst("Couldn't read colors from that flyer."); return set({ palette: b.dataset.col === "flyer" ? fp : [C.contrastPage(fp[0]), ...fp.slice(1)] }); }
        if (b.dataset.sw) { const s = LK.SWATCHES.find((x) => x[0] === b.dataset.sw); return set({ palette: s.slice(0, 3) }); }
        if (b.dataset.fx) return set({ effect: b.dataset.fx === "none" ? undefined : b.dataset.fx });
        if (b.dataset.lights) return set({ lights: L.lights ? undefined : true });
        if ("font" in b.dataset) return set({ titleFont: b.dataset.font || undefined });
        if (b.dataset.lbl) return set({ buttonLabel: b.dataset.lbl });
        if ("em" in b.dataset) return set({ buttonEmoji: b.dataset.em || undefined });
        if (b.id === "mkUpdGo") { const v = box.querySelector("#mkUpd").value.trim().slice(0, 80); return set({ update: v ? { text: v, at: Date.now() } : undefined }, v ? "Update posted. It shows at the top of the invite." : ""); }
        if (b.id === "mkUpdX") return set({ update: undefined }); };
      const upd = box.querySelector("#mkUpd"); if (upd) upd.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); box.querySelector("#mkUpdGo").click(); } };
      const f = box.querySelector("#mkFile"); if (f) f.onchange = async () => { const file = f.files[0]; if (!file) return; const lab = f.closest("label"); lab.firstChild.nodeValue = "Uploading…";
        try { const [url, info] = await Promise.all([appUpload(file), LK.fromFile(file)]); d.coverPhoto = url; d.coverArt = null; flyerPal.set(url, info.palette);
          const L = { ...LK.lookOf(d), coverW: info.w, coverH: info.h, coverFit: info.h > info.w ? "poster" : "banner" }; if (info.palette.length) { L.palette = info.palette; delete L.vibe; } d.look = L; commit("Flyer added. The page picks up its colors."); }
        catch (err) { tst(err.message || "Upload didn't work. Try again."); lab.firstChild.nodeValue = "Upload flyer"; } }; }
    wire(); if (LK.safeSrc(d.coverPhoto)) flyerPalette(LK.safeSrc(d.coverPhoto)).then((p) => { if (p && box.isConnected) { box.innerHTML = panelHTML(d); preview(box, d); wire(); } }); }

  // the wizard's Look step and Edit details: the panel goes in once, above the design cards
  function hosts() { const d = appDraft(); if (!d || d.example) return;
    for (const where of [document.querySelector("#wizBg .wiz-body"), document.querySelector(".fedit")]) { if (!where || where.querySelector("#mkWrap")) continue; const dz = where.querySelector("#dzField"); if (!dz) continue;
      const w = document.createElement("div"); w.id = "mkWrap"; w.style.gridColumn = "1/-1"; const h2 = where.matches(".wiz-body") && where.querySelector("h2"); if (h2) h2.after(w); else dz.before(w);
      mount(w, d, () => appSave()); } }

  let q = 0; new MutationObserver(() => { if (q) return; q = requestAnimationFrame(() => { q = 0; try { guest(); hosts(); } catch (err) { console.warn("[looks]", err); } }); }).observe(document.documentElement, { childList: true, subtree: true });
  window.EncoreLooksApp = { mount, panelHTML, preview, guest, nextLook, rolled };
})();
