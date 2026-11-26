// The Brand kit editor: a calm sheet with a live preview (a mini host page, an event card and an invite), eight starter
// kits named by vibe, "Make it yours" (fonts, colours with contrast checks, corners, buttons, covers, logo, voice line) and
// "Match my logo" (colours sampled from the logo on a canvas, then checked for contrast). Loaded by public/brandkit.js
// when a [data-brandkit] button is pressed. The sheet itself stays in the house faces (.kit-off).
(function () {
  const BK = window.EncoreBrandKit, C = window.EncoreColor; if (!BK) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const GL = (d, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  const X = GL("M5 5l10 10M15 5L5 15"), CHECK = GL("M4.5 10.5l3.5 3.5 7.5-8", 16);
  const CSS = `.bk-bg{position:fixed;inset:0;z-index:2147483000;background:rgba(31,26,23,.42);display:flex;align-items:flex-end;justify-content:center}
@media (min-width:861px){.bk-bg{align-items:center;padding:24px}}
.bk-sheet{--ink:#1F1A17;--smoke:#665A51;--line:#E4D9C8;--ls:#D9CCBB;background:#FFFCF7;color:#1F1A17;font:400 16px/1.45 "Instrument Sans",system-ui,-apple-system,sans-serif;width:min(1040px,100%);max-height:100dvh;height:100dvh;display:grid;grid-template-rows:auto minmax(0,1fr) auto;border-radius:24px 24px 0 0;box-shadow:0 18px 48px -18px rgba(31,26,23,.45);border:1.5px solid #5A3B2B;overflow:hidden;box-sizing:border-box}
@media (min-width:861px){.bk-sheet{height:min(860px,calc(100dvh - 48px));border-radius:24px}}
.bk-sheet *{box-sizing:border-box}.bk-sheet h2,.bk-sheet h3{font-family:var(--sys-display);font-weight:600;margin:0}
.bk-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 16px 12px;border-bottom:1.5px solid var(--line)}.bk-hd h2{font-size:20px}.bk-hd p{margin:2px 0 0;font-size:14px;color:var(--smoke)}
.bk-x{width:44px;height:44px;border-radius:999px;border:1.5px solid var(--ls);background:#fff;color:#5A3B2B;display:grid;place-items:center;cursor:pointer;flex:none}
.bk-body{overflow:auto;display:grid;grid-template-columns:minmax(0,1fr);align-content:start}
@media (min-width:861px){.bk-body{grid-template-columns:minmax(0,1fr) 420px;overflow:hidden}.bk-ctl{overflow:auto}.bk-pvw{overflow:auto;border-left:1.5px solid var(--line)}}
.bk-ctl{padding:16px 16px 24px;display:grid;gap:24px;align-content:start}.bk-sec{display:grid;gap:12px}.bk-sec>h3{font-size:16px}.bk-sec>p.n,.bk-n{margin:0;font-size:13px;color:var(--smoke)}
.bk-sug{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;padding:12px 14px;border-radius:16px;background:#FFF1D2;border:1.5px solid #E9D3A0;font-size:14px}
.bk-st{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}@media (min-width:600px){.bk-st{grid-template-columns:repeat(4,minmax(0,1fr))}}
.bk-tile{display:grid;gap:6px;text-align:left;padding:10px;border-radius:16px;border:1.5px solid var(--line);background:#fff;color:inherit;cursor:pointer;font:inherit;min-height:44px}
.bk-tile[aria-pressed=true]{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
.bk-tile .sw{height:46px;border-radius:10px;display:flex;align-items:flex-end;justify-content:space-between;padding:6px 8px;border:1px solid rgba(0,0,0,.06)}.bk-tile .sw b{font-size:22px;line-height:1}.bk-tile .sw i{width:16px;height:16px;border-radius:50%;display:block}
.bk-tile .t{font-weight:600;font-size:14px;line-height:1.2}.bk-tile small{font-size:13px;color:var(--smoke);line-height:1.2}
.bk-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.bk-opt{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:10px 12px;border-radius:14px;border:1.5px solid var(--line);background:#fff;color:inherit;cursor:pointer;font:inherit;text-align:left;min-height:44px}
.bk-opt[aria-pressed=true]{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}.bk-opt .aa{font-size:22px;line-height:1.1}.bk-opt .bd{font-size:14px;color:var(--smoke)}
.bk-seg{display:flex;flex-wrap:wrap;gap:8px}.bk-seg button{min-height:44px;padding:0 16px;border-radius:999px;border:1.5px solid var(--ls);background:#fff;color:inherit;font:600 14px "Instrument Sans",system-ui,sans-serif;cursor:pointer}.bk-seg button[aria-pressed=true]{background:#1F1A17;color:#fff;border-color:#1F1A17}
.bk-cols{display:grid;gap:8px}.bk-col{display:grid;grid-template-columns:44px minmax(0,1fr) 108px;gap:10px;align-items:center}.bk-col label{font-weight:600;font-size:14px}.bk-col input[type=color]{width:44px;height:44px;border:1.5px solid var(--ls);border-radius:12px;padding:2px;background:#fff;cursor:pointer}
.bk-col input[type=text]{height:44px;border:1.5px solid var(--ls);border-radius:12px;padding:0 10px;font:16px "Instrument Sans",system-ui,sans-serif;width:100%;text-transform:uppercase}
.bk-aa{display:flex;flex-wrap:wrap;gap:6px}.bk-aa span{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:13px;border:1.5px solid var(--line);background:#fff}.bk-aa span.ok{color:#2F5D3A}.bk-aa span.no{color:#B04A30;border-color:#E9B9AA}
.bk-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.bk-btn{min-height:44px;padding:0 16px;border-radius:999px;border:1.5px solid var(--ls);background:#fff;color:inherit;font:600 14px "Instrument Sans",system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.bk-btn.p{background:#C94A30;border-color:#C94A30;color:#fff}.bk-btn:disabled{opacity:.55;cursor:default}.bk-link{background:none;border:0;padding:0 4px;min-height:44px;color:#B04A30;font:600 14px "Instrument Sans",system-ui,sans-serif;text-decoration:underline;cursor:pointer}
.bk-sheet input[type=text]#bkVoice{height:48px;border:1.5px solid var(--ls);border-radius:12px;padding:0 12px;font:16px "Instrument Sans",system-ui,sans-serif;width:100%}
.bk-logo{width:56px;height:56px;border-radius:12px;border:1.5px solid var(--line);background:#fff;object-fit:contain;padding:4px}
.bk-ft{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1.5px solid var(--line);background:#FFFCF7}.bk-ft .msg{font-size:13px;color:var(--smoke)}.bk-ft .r{display:flex;gap:8px}
.bk-sheet :is(button,input,a,summary):focus-visible{outline:3px solid #1F1A17;outline-offset:2px}
.bk-more>summary{min-height:44px;display:flex;align-items:center;gap:8px;cursor:pointer;font:600 16px var(--sys-title);list-style:none}.bk-more>summary::-webkit-details-marker{display:none}.bk-more>summary::after{content:"";width:8px;height:8px;border-right:2px solid #5A3B2B;border-bottom:2px solid #5A3B2B;transform:rotate(45deg);margin-left:4px}.bk-more[open]>summary::after{transform:rotate(-135deg)}
.bk-more>div{display:grid;gap:20px;margin-top:12px}
/* ---- the preview: everything below reads only --kit-* ---- */
.bk-pvw{padding:16px;background:#F3EEE6;display:grid;gap:14px;align-content:start}.bk-pvw>b{font:600 13px "Instrument Sans",system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#665A51}
.bk-pv{font-family:var(--kit-body);color:var(--kit-ink);display:grid;gap:12px}
.bk-pv .d{font-family:var(--kit-display);font-weight:var(--kit-dw);letter-spacing:var(--kit-dls);color:var(--kit-ink);margin:0;line-height:1.1}
.bk-pv .fr{border-radius:18px;overflow:hidden;border:1px solid rgba(31,26,23,.12);box-shadow:0 10px 28px -16px rgba(31,26,23,.28)}
.bk-pv .cap{font:600 12px "Instrument Sans",system-ui,sans-serif;color:#665A51;margin:0 0 4px}
.bk-pv .pg{background:var(--kit-page);padding:0 0 14px}.bk-pv .cv{height:64px;background:linear-gradient(135deg,color-mix(in srgb,var(--kit-accent) 30%,var(--kit-page)),var(--kit-page));position:relative;overflow:hidden}.bk-pv .cv svg{position:absolute;right:10px;top:4px;height:56px;width:auto}
.bk-pv .hd{display:flex;gap:10px;align-items:flex-end;padding:0 14px;margin-top:-22px;position:relative}.bk-pv .av{width:52px;height:52px;border-radius:50%;background:var(--kit-surface);border:3px solid var(--kit-page);display:grid;place-items:center;font-size:24px;overflow:hidden}.bk-pv .av img{width:100%;height:100%;object-fit:contain}
.bk-pv .nm{font-size:calc(20px * var(--kit-dk,1))}.bk-pv .vc{font-size:13px;color:var(--kit-soft);padding:4px 14px 0;margin:0}
.bk-pv .nu{margin:10px 12px 0;background:var(--kit-surface);border:1px solid var(--kit-line);border-radius:var(--kit-r-card);padding:12px 14px;position:relative;overflow:hidden}.bk-pv .nu::before{content:"";position:absolute;inset:0 0 auto;height:3px;background:var(--kit-accent)}
.bk-pv .ey{font:600 11px var(--kit-body);letter-spacing:.12em;text-transform:uppercase;color:var(--kit-accent-text)}.bk-pv .nt{font-size:calc(22px * var(--kit-dk,1));margin:4px 0 2px}.bk-pv .sb{font-size:13px;color:var(--kit-soft)}
.bk-pv .ch{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.bk-pv .ch span{font:500 12px/1.2 var(--kit-body);padding:4px 10px;border:1.5px solid var(--kit-line-strong);border-radius:var(--kit-r-chip);color:var(--kit-ink)}
.bk-pv ul{list-style:none;margin:6px 0;padding:0;display:grid;gap:2px}.bk-pv li{font-size:14px;display:grid;grid-template-columns:14px 1fr;align-items:center}.bk-pv li::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--kit-accent)}
.bk-pv .ct{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid var(--kit-line);padding-top:10px;margin-top:8px}.bk-pv .pr{font:600 16px var(--kit-body);font-variant-numeric:tabular-nums}.bk-pv .pr small{font-weight:400;color:var(--kit-soft);font-size:12px}
.bk-pv .bt{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 16px;border-radius:var(--kit-r-btn);background:var(--kit-btn);color:var(--kit-on-btn);font:600 14px var(--kit-body);border:1.5px solid var(--kit-btn)}
.bk-pv.out .bt{background:transparent;color:var(--kit-accent-text)}
.bk-pv .ec{background:var(--kit-surface);display:grid;grid-template-columns:96px minmax(0,1fr);gap:0}.bk-pv .ec .im{min-height:110px;background:color-mix(in srgb,var(--kit-accent) 18%,var(--kit-page));display:grid;place-items:center;overflow:hidden}.bk-pv .ec .im svg{width:84%;height:auto}
.bk-pv .ec .im.deck{background:var(--kit-accent2);margin:8px;border-radius:12px;border:2px solid var(--kit-surface);box-shadow:0 0 0 1.5px var(--kit-line-strong)}.bk-pv .ec .im.photo{background:linear-gradient(160deg,color-mix(in srgb,var(--kit-accent) 55%,#2B211C),color-mix(in srgb,var(--kit-accent2) 70%,#fff))}
.bk-pv .ec .tx{padding:12px;display:grid;gap:4px;align-content:center}.bk-pv .ec .ttl{font-size:calc(17px * var(--kit-dk,1))}.bk-pv .ec small{font-size:12px;color:var(--kit-soft)}
.bk-pv .iv{background:linear-gradient(180deg,color-mix(in srgb,var(--kit-page) 60%,#fff),var(--kit-page));padding:16px 14px;display:grid;gap:8px}.bk-pv .iv .it{font-size:calc(26px * var(--kit-dk,1))}.bk-pv .iv p{margin:0;font-size:13px;color:var(--kit-soft)}.bk-pv .iv p b{color:var(--kit-ink);font-weight:600}.bk-pv .iv .bt{width:100%;min-height:40px}
/* phones: the preview stays in view above the choices, as a strip you can swipe (page, card, invite) */
@media (max-width:860px){.bk-body{grid-template-rows:auto minmax(0,1fr);overflow:hidden}.bk-ctl{overflow:auto;min-height:0}.bk-pvw{order:-1;padding:10px 16px;display:flex;gap:10px;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;border-bottom:1.5px solid var(--line);max-height:232px}.bk-pvw>b,.bk-pvw>.bk-n{display:none}.bk-pv{display:contents}.bk-pv>div{flex:0 0 min(80%,300px);scroll-snap-align:start;zoom:.74}}
@media (prefers-reduced-motion:no-preference){.bk-tile,.bk-opt{transition:border-color .15s,box-shadow .15s}}`;
  function css() { if (document.getElementById("bk-ed-css")) return; const s = document.createElement("style"); s.id = "bk-ed-css"; s.textContent = CSS; document.head.appendChild(s); }

  const FIELDS = [["page", "Page"], ["surface", "Cards"], ["ink", "Text"], ["accent", "Accent"], ["accent2", "Second accent"]];
  const LABEL = { corners: { soft: "Soft", crisp: "Crisp" }, buttons: { pill: "Filled pill", outline: "Outlined" }, cover: { photo: "Photo", lineart: "Line art", deck: "Card deck" } };
  const art = (k, color) => { try { return window.EventArt?.drawing ? window.EventArt.drawing(k, color) : ""; } catch { return ""; } };
  const kindOf = (S) => ({ terminal: "tech", arcade: "games", pantry: "dinner", supper: "dinner", florist: "flowers", market: "market", studio: "run" })[S] || "dinner";

  // ---- Match my logo: colours from the logo's pixels, then made to read ----
  async function readLogo(file) { const url = URL.createObjectURL(file); try { const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("That image didn't open.")); i.src = url; });
      const n = 96, cv = document.createElement("canvas"), r = Math.min(1, n / Math.max(img.naturalWidth, img.naturalHeight)); cv.width = Math.max(1, Math.round(img.naturalWidth * r)); cv.height = Math.max(1, Math.round(img.naturalHeight * r));
      const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, cv.width, cv.height); return C.paletteFromPixels(g.getImageData(0, 0, cv.width, cv.height).data); } finally { URL.revokeObjectURL(url); } }
  function fromLogo(pal, k) { if (!pal?.length) return null; const by = [...pal].sort((a, b) => C.hsl(b)[1] * (1 - Math.abs(C.lum(b) - 0.25)) - C.hsl(a)[1] * (1 - Math.abs(C.lum(a) - 0.25)));
    const accent = by[0], accent2 = by.find((c) => c !== accent) || C.mix(accent, "#FFFFFF", 0.5), page = C.mix(pal[0] === accent ? accent : pal[0], "#FFFFFF", pal[0] === accent ? 0.9 : 0.72), surface = "#FFFFFF";
    return { ...k, page, surface, ink: C.inkFor([page, surface], accent), accent, accent2, starter: "" }; }

  async function upload(file) { if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use a PNG, JPEG or WebP image."); if (file.size > 2 * 1024 * 1024) throw new Error("That image is over 2 MB. Try a smaller one.");
    const r = await fetch("/api/assets", { method: "POST", credentials: "same-origin", headers: { "Content-Type": file.type }, body: file }); const j = await r.json().catch(() => ({})); if (!r.ok || !j.url) throw new Error(j.message || "Upload didn't work. Try again."); return j.url; }

  let open0 = null;
  async function open({ opener = null, starter = "" } = {}) { if (open0) return open0; css();
    let info; try { const r = await fetch("/api/host/brandkit", { credentials: "same-origin" }); info = r.ok ? await r.json() : null; } catch { info = null; }
    if (!info) { alert("Sign in to your page to make a brand kit."); return null; }
    let sample = null; try { if (info.handle) { const r = await fetch("/api/public/host/" + encodeURIComponent(info.handle)); if (r.ok) { const j = await r.json(); sample = { name: j.host?.name, emoji: j.host?.emoji, e: (j.upcoming || [])[0] || (j.past || [])[0] || null }; } } } catch {}
    const saved0 = JSON.stringify(info.kit);
    let k = { ...info.kit }; if (starter && BK.STARTERS[starter] && !info.saved) k = { ...BK.starter(starter), logo: k.logo || "", voice: k.voice || "" };
    const bg = document.createElement("div"); bg.className = "bk-bg kit-off"; bg.innerHTML = `<div class="bk-sheet" role="dialog" aria-modal="true" aria-labelledby="bkTitle"></div>`; const sh = bg.firstChild;
    const prevFocus = opener || document.activeElement; let more = !!info.saved && !k.starter, busy = false, msg = "";
    const sug = !info.saved && info.suggest && BK.STARTERS[info.suggest.starter] ? info.suggest : null;
    const S = sample?.e || {}, title = S.dinnerTheme || S.title || "Autumn supper", when = S.date ? new Date(S.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "Sat, Dec 12";
    const courses = (S.courses || []).slice(0, 3); const menu = courses.length ? courses : ["Something to start", "The main thing", "Something sweet"];
    const hostName = sample?.name || info.name || "Your page", price = S.priceLine || (S.price && S.price !== "chip" ? S.price + " a person" : "$40 a person");
    // the drawing on the preview covers: what this host's next event is, else what the kit suggests
    const evKind = (() => { try { return sample?.e && window.EventArt?.kindOf ? String(window.EventArt.kindOf({ ...sample.e, name: sample.e.title })).split("+")[0] : ""; } catch { return ""; } })();
    function preview() { const F = BK.fonts(k), T = BK.derive(k), P = BK.PAIRS[k.pair];
      const cover = k.cover === "deck" ? "deck" : k.cover === "photo" ? "photo" : "line";
      return `<div class="bk-pv${k.buttons === "outline" ? " out" : ""}" id="bkPv" aria-hidden="true">
        <div><p class="cap">Your page</p><div class="fr pg"><div class="cv">${art(evKind || kindOf(k.starter || k.pair), T.accent)}</div><div class="hd"><span class="av">${k.logo ? `<img src="${esc(k.logo)}" alt="">` : esc(sample?.emoji || "🍽")}</span><b class="d nm">${esc(hostName)}</b></div>${k.voice ? `<p class="vc">${esc(k.voice)}</p>` : ""}
          <div class="nu"><span class="ey">Next up</span><p class="d nt">${esc(title)}</p><div class="ch"><span>${esc(when)}</span><span>${esc(S.hood || S.city || "Your place")}</span><span>${esc(S.headcount ? S.headcount + " spots" : "12 spots")}</span></div><ul>${menu.map((c) => `<li>${esc(c)}</li>`).join("")}</ul><div class="ct"><span class="pr">${esc(price.replace(/ a person$/, ""))}${/ a person$/.test(price) ? ` <small>a person</small>` : ""}</span><span class="bt">I'm in</span></div></div></div></div>
        <div><p class="cap">An event card</p><div class="fr ec"><div class="im ${cover === "line" ? "" : cover}">${cover === "photo" ? "" : art(evKind || kindOf(k.starter || k.pair), cover === "deck" ? T.ink : T.accent)}</div><div class="tx"><b class="d ttl">${esc(title)}</b><small>${esc(when)} · ${esc(S.hood || S.city || "Your place")}</small><span><span class="bt">I'm in</span></span></div></div></div>
        <div><p class="cap">The invite</p><div class="fr iv"><b class="d it">${esc(title)}</b><p><b>${esc(when)}${S.startTime ? "" : " · 7pm"}</b></p><p>${esc(S.hood || S.city || "Your place")} · ${esc(hostName)} is hosting</p><span class="bt">I'm in</span></div></div>
      </div><p class="bk-n" style="margin:0">${esc(P.label)}: ${esc(P.display)} for titles, ${esc(P.body)} for everything else.</p>`; }
    function pressed(on) { return `aria-pressed="${!!on}"`; }
    function draw() { const checks = BK.checks(k), fixedInk = C && k.ink && C.norm(k.ink) !== BK.derive(k).ink;
      sh.innerHTML = `<div class="bk-hd"><div><h2 id="bkTitle">Brand kit</h2><p>One look for your page, events and invites.</p></div><button type="button" class="bk-x" id="bkX" aria-label="Close">${X}</button></div>
      <div class="bk-body"><div class="bk-ctl">
        ${sug ? `<div class="bk-sug"><span>Potto picked <b>${esc(BK.STARTERS[sug.starter].label)}</b> ${esc(sug.why)}.</span><button type="button" class="bk-btn p" data-st="${esc(sug.starter)}" data-go="1">Use ${esc(BK.STARTERS[sug.starter].label)}</button></div>` : ""}
        <section class="bk-sec" aria-labelledby="bkS1"><h3 id="bkS1">Start from</h3><div class="bk-st" role="group" aria-labelledby="bkS1">${Object.entries(BK.STARTERS).map(([id, s]) => { const T = BK.derive(s), F = BK.fonts(s);
          return `<button type="button" class="bk-tile" data-st="${id}" ${pressed(k.starter === id)}><span class="sw" style="background:${T.page}"><b style="font-family:${esc(F.display)};font-weight:${F.dw};color:${T.ink}">Aa</b><span style="display:flex;gap:3px"><i style="background:${T.btn}"></i><i style="background:${T.accent2}"></i></span></span><span class="t">${esc(s.label)}</span><small>${esc(s.vibe)}</small></button>`; }).join("")}</div></section>
        <details class="bk-more" id="bkMore"${more ? " open" : ""}><summary>Make it yours</summary><div>
          <section class="bk-sec" aria-labelledby="bkS2"><h3 id="bkS2">Fonts</h3><p class="n">A display face for titles and a body face for everything else. Never more than these two.</p><div class="bk-grid2" role="group" aria-labelledby="bkS2">${Object.entries(BK.PAIRS).map(([id, P]) => { const F = BK.fonts({ pair: id });
            return `<button type="button" class="bk-opt" data-pair="${id}" ${pressed(k.pair === id)}><span class="aa" style="font-family:${esc(F.display)};font-weight:${F.dw}">${esc(P.label)}</span><span class="bd" style="font-family:${esc(F.body)}">${esc(P.display)} + ${esc(P.body)}</span></button>`; }).join("")}</div></section>
          <section class="bk-sec" aria-labelledby="bkS3"><h3 id="bkS3">Colors</h3><div class="bk-row"><label class="bk-btn" for="bkLogoM">Match my logo<input type="file" id="bkLogoM" accept="image/png,image/jpeg,image/webp" hidden></label><span class="bk-n">Pulls colors from your logo, then checks they read.</span></div>
            <div class="bk-cols">${FIELDS.map(([f, l]) => `<div class="bk-col"><input type="color" id="bkc-${f}" data-col="${f}" value="${esc(C.norm(k[f]) || (f === "accent2" ? BK.derive(k).accent2 : "#FFFFFF"))}" aria-label="${esc(l)} color"><label for="bkt-${f}">${esc(l)}</label><input type="text" id="bkt-${f}" data-hex="${f}" value="${esc(C.norm(k[f]) || "")}" maxlength="7" inputmode="text" autocomplete="off" spellcheck="false" placeholder="${f === "accent2" ? "Optional" : "#RRGGBB"}"></div>`).join("")}</div>
            <div class="bk-aa" aria-live="polite">${checks.map((c) => `<span class="${c.ok ? "ok" : "no"}">${c.ok ? CHECK : ""}${esc(c.label)} ${c.ratio}:1</span>`).join("")}</div>
            <p class="n">${fixedInk ? "Your text color was too light to read, so it's darker here. " : ""}Buttons and accent text are adjusted until they pass AA.</p></section>
          <section class="bk-sec" aria-labelledby="bkS4"><h3 id="bkS4">Shape</h3>${["corners", "buttons", "cover"].map((g) => `<div class="bk-row" role="group" aria-label="${g === "cover" ? "Covers" : g === "buttons" ? "Buttons" : "Corners"}"><span class="bk-n" style="min-width:64px">${g === "cover" ? "Covers" : g === "buttons" ? "Buttons" : "Corners"}</span><div class="bk-seg">${BK.ENUMS[g].map((v) => `<button type="button" data-g="${g}" data-v="${v}" ${pressed(k[g] === v)}>${LABEL[g][v]}</button>`).join("")}</div></div>`).join("")}${window.EncoreStore?.coverSheet && document.querySelector(".cover") ? `<div class="bk-row"><span class="bk-n" style="min-width:64px">Page cover</span><div class="bk-seg"><button type="button" id="bkCover">Change cover</button></div></div>` : ""}</section>
          <section class="bk-sec" aria-labelledby="bkS5"><h3 id="bkS5">Logo and voice</h3><div class="bk-row">${k.logo ? `<img class="bk-logo" src="${esc(k.logo)}" alt="Your logo">` : ""}<label class="bk-btn" for="bkLogo">${k.logo ? "Change logo" : "Add a logo"}<input type="file" id="bkLogo" accept="image/png,image/jpeg,image/webp" hidden></label>${k.logo ? `<button type="button" class="bk-link" id="bkLogoX">Remove</button>` : ""}<span class="bk-n">PNG, JPEG or WebP, up to 2 MB.</span></div>
            <label for="bkVoice" style="font-weight:600;font-size:14px">Voice line</label><input type="text" id="bkVoice" maxlength="80" placeholder="Twelve seats, seven courses, and cake on Saturdays." value="${esc(k.voice || "")}"><span class="bk-n">One line under your name. It's your page's tagline too.</span></section>
        </div></details>
      </div><aside class="bk-pvw" aria-label="Preview"><b>Preview</b>${preview()}</aside></div>
      <div class="bk-ft"><span class="msg" role="status" aria-live="polite">${esc(msg)}</span><span class="r"><button type="button" class="bk-btn" id="bkCancel">Cancel</button><button type="button" class="bk-btn p" id="bkSave"${busy ? " disabled" : ""}>${busy ? "Saving…" : "Save brand kit"}</button></span></div>`;
      const pv = sh.querySelector(".bk-pvw"); BK.paint(k, pv); BK.loadFonts(k); }
    // starter tiles show in their own faces
    Object.values(BK.STARTERS).forEach((s) => BK.loadFonts(s));
    const refocus = (sel) => { const el = sh.querySelector(sel); if (el) el.focus(); };
    const redraw = (focusSel) => { const sc = sh.querySelector(".bk-ctl")?.scrollTop || 0, body = sh.querySelector(".bk-body")?.scrollTop || 0; more = !!sh.querySelector("#bkMore")?.open || more; draw(); const c = sh.querySelector(".bk-ctl"); if (c) c.scrollTop = sc; const b = sh.querySelector(".bk-body"); if (b) b.scrollTop = body; if (focusSel) refocus(focusSel); };
    const close = () => { document.removeEventListener("keydown", onKey, true); bg.remove(); document.documentElement.style.overflow = ""; open0 = null; try { prevFocus?.focus?.(); } catch {} };
    const dirty = () => JSON.stringify(k) !== saved0;
    function onKey(ev) { if (ev.key === "Escape") { ev.preventDefault(); close(); return; }
      if (ev.key === "Tab") { const F = [...sh.querySelectorAll("button:not([disabled]),input:not([type=file]),summary,label.bk-btn,[tabindex]:not([tabindex='-1'])")].filter((x) => x.offsetParent !== null); if (!F.length) return; const a = F[0], z = F[F.length - 1];
        if (ev.shiftKey && document.activeElement === a) { ev.preventDefault(); z.focus(); } else if (!ev.shiftKey && document.activeElement === z) { ev.preventDefault(); a.focus(); } } }
    async function save() { if (busy) return; busy = true; msg = ""; redraw("#bkSave");
      try { const r = await fetch("/api/host/brandkit", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(k) }); const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message || "That didn't save. Try again."); BK.saved(j.kit); close(); try { if (typeof window.toast === "function") window.toast("Saved. Your page, events and invites wear it now."); } catch {}
        if (document.body.classList.contains("store")) { const t = document.createElement("div"); t.className = "bk-sug kit-off"; t.setAttribute("role", "status"); t.innerHTML = `<span><b>Saved.</b> Your page, events and invites wear your brand kit now.</span>`; (document.querySelector("main") || document.body).prepend(t); setTimeout(() => t.remove(), 5000); } }
      catch (err) { busy = false; msg = err.message; redraw("#bkSave"); } }
    sh.addEventListener("click", async (ev) => { const b = ev.target.closest("button"); if (!b || !sh.contains(b)) return;
      if (b.id === "bkX" || b.id === "bkCancel") return close();
      if (b.id === "bkSave") return save();
      if (b.id === "bkCover") { close(); return window.EncoreStore.coverSheet(window.__encoreStoreHost || {}); }
      if (b.dataset.st) { const s = BK.starter(b.dataset.st); k = { ...s, logo: k.logo || "", voice: k.voice || "" }; redraw(`[data-st="${b.dataset.st}"].bk-tile`); if (b.dataset.go) return save(); return; }
      if (b.dataset.pair) { k = { ...k, pair: b.dataset.pair, starter: "" }; return redraw(`[data-pair="${b.dataset.pair}"]`); }
      if (b.dataset.g) { k = { ...k, [b.dataset.g]: b.dataset.v, starter: "" }; return redraw(`[data-g="${b.dataset.g}"][data-v="${b.dataset.v}"]`); }
      if (b.id === "bkLogoX") { k = { ...k, logo: "" }; return redraw("#bkLogo"); } });
    sh.addEventListener("input", (ev) => { const t = ev.target; if (t.dataset.col) { k = { ...k, [t.dataset.col]: t.value.toUpperCase(), starter: "" }; const tx = sh.querySelector(`#bkt-${t.dataset.col}`); if (tx) tx.value = t.value.toUpperCase(); clearTimeout(open.t); open.t = setTimeout(() => redraw(`#bkc-${t.dataset.col}`), 120); }
      if (t.dataset.hex) { const v = C.norm(t.value.startsWith("#") ? t.value : "#" + t.value); if (v || (t.dataset.hex === "accent2" && !t.value.trim())) { k = { ...k, [t.dataset.hex]: v, starter: "" }; clearTimeout(open.t); open.t = setTimeout(() => redraw(`#bkt-${t.dataset.hex}`), 300); } }
      if (t.id === "bkVoice") { k = { ...k, voice: t.value.replace(/\s*[—–]\s*/g, ", ").slice(0, 80) }; const p = sh.querySelector(".bk-pvw"); if (p) { p.innerHTML = `<b>Preview</b>${preview()}`; BK.paint(k, p); } } });
    sh.addEventListener("toggle", (ev) => { if (ev.target.id === "bkMore") more = ev.target.open; }, true);
    sh.addEventListener("change", async (ev) => { const t = ev.target; if (t.type !== "file" || !t.files?.[0]) return; const f = t.files[0]; msg = t.id === "bkLogoM" ? "Reading your logo…" : "Uploading…"; redraw();
      try { if (t.id === "bkLogoM") { const pal = await readLogo(f), n = fromLogo(pal, k); if (!n) throw new Error("Couldn't find colors in that logo."); const url = await upload(f).catch(() => ""); k = { ...n, logo: url || k.logo }; const c = BK.checks(k); msg = c.every((x) => x.ok) ? "Colors from your logo. Everything reads." : "Colors from your logo, adjusted so they read."; }
        else { const url = await upload(f); k = { ...k, logo: url }; msg = "Logo added."; } }
      catch (err) { msg = err.message; } more = true; redraw(t.id === "bkLogoM" ? "label[for=bkLogoM]" : "label[for=bkLogo]"); });
    // labels that act as file buttons answer Enter and Space
    sh.addEventListener("keydown", (ev) => { const l = ev.target.closest?.("label.bk-btn"); if (l && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); l.querySelector("input[type=file]")?.click(); } });
    bg.addEventListener("click", (ev) => { if (ev.target === bg && !dirty()) close(); });
    draw(); sh.querySelectorAll("label.bk-btn").forEach((l) => l.tabIndex = 0); document.body.appendChild(bg); document.documentElement.style.overflow = "hidden"; document.addEventListener("keydown", onKey, true);
    const MO = new MutationObserver(() => sh.querySelectorAll("label.bk-btn:not([tabindex])").forEach((l) => (l.tabIndex = 0))); MO.observe(sh, { childList: true, subtree: true });
    setTimeout(() => (sh.querySelector(".bk-tile[aria-pressed=true]") || sh.querySelector(".bk-tile"))?.focus(), 30);
    open0 = Promise.resolve(sh); return sh; }
  window.EncoreBrandKitEditor = { open, fromLogo, readLogo };
})();
