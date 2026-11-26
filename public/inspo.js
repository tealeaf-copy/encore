// Inspo cards: one card for the /ideas wall, the feed or anywhere else. window.PLInspo.card(item) returns HTML for an
// item from GET /api/public/inspo (types: photo, flyer, art, idea). Photos sit like instant photos with butter tape;
// flyers are mini invites in the event's own look; ideas get an illustrated cover (EventArt) and a look to host it in.
// Actions: Save (public/save.js), "Host this" (opens a new event from the idea; signed out, signup first, and the idea
// waits), and "See the real one" when the card came from a real event.
(function () {
  if (window.PLInspo) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const okHex = (h) => /^#[0-9a-f]{6}$/i.test(h || "");
  const safeImg = (u) => (/^\/_blob\/[A-Za-z0-9]{6,40}$/.test(u || "") || /^\/presets\/[A-Za-z0-9_.-]{1,80}$/.test(u || "") || /^https:\/\/[^\s"'<>()]+$/.test(u || "") ? u : "");
  const safeUrl = (u) => (/^\/[A-Za-z0-9@_\-./#?=&%]*$/.test(u || "") && !/^\/\//.test(u) ? u : "");
  let INT = []; const intLabel = (id) => INT.find((i) => i.id === id);
  const items = new Map();
  const FONT_CSS = { clean: "'Inter','Instrument Sans',system-ui,sans-serif", bold: "'Archivo Black','Arial Black',system-ui,sans-serif", serif: "'DM Serif Display',Georgia,serif", script: "'Dancing Script','Brush Script MT',cursive", typewriter: "'Courier Prime','Courier New',monospace", rounded: "'Baloo 2',Fredoka,system-ui,sans-serif" };
  const TAPE = ["rgba(242,212,143,.92)", "rgba(251,211,203,.9)", "rgba(205,235,213,.9)", "rgba(226,214,247,.9)"];

  const CSS = `.fv-inspo .pli{flex:0 0 min(78vw,260px)!important;width:min(78vw,260px)!important;margin:0 !important}.fv-inspo .pli-vibe{display:none!important}
.pli{position:relative;break-inside:avoid;margin:0 0 18px;display:block;color:#1F1A17;font:15px/1.4 "Instrument Sans",system-ui,sans-serif;transform:rotate(var(--tilt,0deg));transition:transform .3s cubic-bezier(.3,1.5,.5,1)}
@media (hover:hover){.pli:hover{transform:rotate(0deg) translateY(-3px)}}
.pli-card{background:#FFFDF8;border:2px solid #1F1A17;border-radius:20px;overflow:visible;box-shadow:3px 3px 0 #1F1A17}
.pli-media{position:relative;margin:10px 10px 0;border-radius:12px;overflow:hidden;background:#EFE6D8;border:1.5px solid #1F1A17}
.pli-photo .pli-media{border-radius:4px;margin:12px 12px 0;background:#fff;padding:0;border:0;box-shadow:0 1px 0 rgba(0,0,0,.05)}
.pli-photo .pli-media img{display:block;width:100%;height:auto;min-height:120px;max-height:520px;object-fit:cover;border-radius:3px;border:1.5px solid #1F1A17;background:#EFE6D8}
.pli-tape{position:absolute;top:-2px;left:50%;width:78px;height:24px;transform:translate(-50%,-50%) rotate(var(--tt,-4deg));background:var(--tc,rgba(242,212,143,.92));z-index:2;border-radius:2px;box-shadow:0 1px 1px rgba(0,0,0,.08)}
.pli-cap{font:600 22px/1.05 Caveat,"Segoe Print","Bradley Hand",cursive;color:#3A302A;padding:8px 14px 0;transform:rotate(-1.2deg)}
.pli-art{aspect-ratio:var(--ar,4/5)}.pli-art .ea-cover{position:absolute!important;inset:0}
.pli-body{padding:10px 14px 14px;display:grid;gap:6px}
.pli-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.pli-title{font:600 18px/1.15 Fredoka,"Instrument Sans",system-ui,sans-serif;margin:0;overflow-wrap:anywhere}
.pli-line{color:#665A51;font-size:14px;margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pli-by{font-size:14px;margin:0;display:flex;gap:6px;align-items:center;flex-wrap:wrap}.pli-by a{color:#1F1A17;font-weight:600;text-decoration:none;border-bottom:2px solid #F2D48F}.pli-by a:hover{border-color:#C94A30}
.pli-tags{display:flex;gap:5px;flex-wrap:wrap}.pli-tags button{border:1.5px solid #D9CCBB;background:#fff;border-radius:999px;padding:0 12px;font:600 13px var(--sys-sans,system-ui);color:#1F1A17;cursor:pointer;min-height:36px}@media (max-width:860px){.pli-tags button{min-height:44px}}.pli-tags button:hover{background:#FFF1D2}
.pli-acts{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px}
.pli-host{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 14px;border:2px solid #1F1A17;border-radius:999px;background:#C94A30;color:#fff;font:600 14px "Instrument Sans",system-ui;cursor:pointer;box-shadow:2px 2px 0 #1F1A17;text-decoration:none}
.pli-host:hover{background:#A63A22}.pli-real{font-weight:600;font-size:14px;color:#A63A22;text-decoration:underline;text-underline-offset:3px;min-height:40px;display:inline-flex;align-items:center}
.pli-count{font-size:13px;color:#665A51;margin:0}.pli-count:empty{display:none}
.pli-ex{position:absolute;top:10px;right:10px;z-index:3;background:#fff;border:1.5px solid #1F1A17;border-radius:999px;padding:2px 9px;font:700 13px var(--sys-sans,system-ui);letter-spacing:.02em;transform:rotate(4deg)}
.pli-kind{position:absolute;left:10px;bottom:10px;z-index:3;background:#1F1A17;color:#fff;border-radius:999px;padding:3px 10px;font:600 13px var(--sys-sans,system-ui)}
.pli-fly{position:relative;aspect-ratio:3/4;background:linear-gradient(180deg,var(--f0) 0,var(--f0b) 100%);color:var(--f1);display:flex;flex-direction:column;justify-content:space-between;padding:18px 16px 16px;overflow:hidden}
.pli-fly .pli-ft{font-family:var(--ff,Fredoka);font-weight:var(--fw,700);font-size:clamp(22px,2.4vw + 8px,32px);line-height:1.02;letter-spacing:-.01em;margin:0;text-wrap:balance;position:relative;z-index:1}
.pli-fly.up .pli-ft{text-transform:uppercase}
.pli-fly small{font:600 13px "Instrument Sans",system-ui;opacity:.85;position:relative;z-index:1}
.pli-fly .pli-fb{align-self:flex-start;position:relative;z-index:1;background:var(--f2);color:var(--f2i);border:2px solid var(--f1);border-radius:999px;padding:8px 14px;font:700 14px "Instrument Sans",system-ui;box-shadow:2px 2px 0 var(--f1)}
.pli-fly .pli-fx{position:absolute;inset:0;pointer-events:none;opacity:.85}
.fx-sparkles{background-image:radial-gradient(circle,var(--f2) 1.6px,transparent 2.2px),radial-gradient(circle,#fff 1.2px,transparent 1.8px);background-size:46px 52px,31px 37px;background-position:0 0,14px 20px}
.fx-snow{background-image:radial-gradient(circle,#fff 2.4px,transparent 3px),radial-gradient(circle,#fff 1.5px,transparent 2px);background-size:40px 44px,23px 29px;background-position:0 0,11px 15px}
.fx-confetti{background-image:linear-gradient(45deg,transparent 46%,var(--f2) 47% 53%,transparent 54%),linear-gradient(-45deg,transparent 46%,var(--f1) 47% 53%,transparent 54%);background-size:34px 40px,27px 31px;opacity:.35}
.fx-petals{background-image:radial-gradient(ellipse 6px 3px,var(--f2) 90%,transparent 100%),radial-gradient(ellipse 4px 7px,#fff 90%,transparent 100%);background-size:52px 48px,37px 41px;background-position:0 0,18px 22px;opacity:.6}
.fx-stars,.fx-twinkle{background-image:radial-gradient(circle,#FFF6D8 1.4px,transparent 2px),radial-gradient(circle,var(--f2) 1px,transparent 1.6px);background-size:28px 33px,47px 41px;background-position:0 0,9px 17px}
.fx-velvet{background:radial-gradient(120% 80% at 30% 10%,rgba(255,255,255,.18),transparent 60%),repeating-linear-gradient(90deg,rgba(0,0,0,.08) 0 2px,transparent 2px 6px)}
.fx-paper{background-image:repeating-linear-gradient(0deg,rgba(0,0,0,.04) 0 1px,transparent 1px 4px);opacity:1}
.pli-vibe{display:flex;align-items:center;gap:8px;margin:10px 10px 0;padding:8px 10px;border-radius:12px;border:1.5px solid #1F1A17;background:var(--f0);color:var(--f1);font:600 13px "Instrument Sans",system-ui}
.pli-vibe i{font-style:normal;margin-left:auto;background:var(--f2);color:var(--f2i);border-radius:999px;padding:3px 10px;border:1.5px solid var(--f1);white-space:nowrap}
.pli-sticker{position:absolute;z-index:4;top:-14px;left:-10px;transform:rotate(-8deg);background:#F2D48F;border:2px solid #1F1A17;border-radius:999px;padding:3px 10px;font:600 13px Fredoka,system-ui;box-shadow:2px 2px 0 #1F1A17}
/* on a flyer the host's name sits top left, so the sticker goes top right and Example drops to the corner below */
.pli-flyer .pli-sticker{left:auto;right:-8px;transform:rotate(7deg)}.pli-flyer .pli-ex{top:auto;bottom:10px}
.pli-fade{animation:pliIn .5s cubic-bezier(.3,1.3,.5,1) both}@keyframes pliIn{from{opacity:0;transform:translateY(14px) rotate(var(--tilt,0deg))}}
@media (prefers-reduced-motion:reduce){.pli,.pli-fade{transition:none;animation:none}}`;
  const css = () => { if (document.getElementById("pliCss")) return; const s = document.createElement("style"); s.id = "pliCss"; s.textContent = CSS; document.head.appendChild(s); };

  // a look's colours: page, ink, accent, and the button's text
  const lum = (h) => { const n = parseInt(h.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const shade = (h, k) => { const n = parseInt(h.slice(1), 16), f = (v) => Math.max(0, Math.min(255, Math.round(v + (k > 0 ? (255 - v) * k : v * k)))); return "#" + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join(""); };
  function lookVars(L) { const p = (L?.palette || []).filter(okHex); const bg = p[0] || "#FDE6A6", dark = lum(bg) < 0.25;
    let ink = p[1] && contrast(p[1], bg) >= 4.5 ? p[1] : dark ? "#FFFDF8" : "#1F1A17"; let acc = p[2] || p[1] || "#C94A30"; if (contrast(acc, bg) < 1.4) acc = dark ? "#F2D48F" : "#C94A30";
    // the stamp's text must reach 4.5:1: nudge the accent darker (white text) or lighter (ink text) until it does
    for (let i = 0; i < 8 && Math.max(contrast("#1F1A17", acc), contrast("#FFFFFF", acc)) < 4.5; i++) acc = shade(acc, contrast("#FFFFFF", acc) >= contrast("#1F1A17", acc) ? -0.08 : 0.08);
    const accInk = contrast("#1F1A17", acc) >= contrast("#FFFFFF", acc) ? "#1F1A17" : "#FFFFFF";
    return `--f0:${bg};--f0b:${shade(bg, dark ? 0.12 : -0.08)};--f1:${ink};--f2:${acc};--f2i:${accInk}`; }
  const fontOf = (L) => { const k = L?.titleFont; if (k && window.EncoreLooks?.loadFont) try { window.EncoreLooks.loadFont(k); } catch {} return FONT_CSS[k] || "Fredoka,system-ui,sans-serif"; };
  const btnText = (L) => `${L?.buttonEmoji ? L.buttonEmoji + " " : ""}${L?.buttonLabel || "I'm in"}`;
  const vibeName = (L) => (L?.vibe && window.EncoreLooks?.VIBES?.[L.vibe]?.label) || "";

  function media(x) { const ex = x.example ? `<span class="pli-ex">Example</span>` : "";
    if (x.type === "photo") { const h = hash(x.id); return `<div class="pli-media"><span class="pli-tape" style="--tt:${(h % 9) - 4}deg;--tc:${TAPE[h % TAPE.length]}"></span>${ex}<img src="${esc(safeImg(x.img))}" alt="${esc(x.title)}" loading="lazy" decoding="async"></div><div class="pli-cap">${esc(x.title)}</div>`; }
    if (x.type === "flyer") { const L = x.look || {}, d = x.line.split(" · ").slice(-2).join(" · ");
      return `<div class="pli-media"><div class="pli-fly${L.titleFont === "bold" ? " up" : ""}" style="${lookVars(L)};--ff:${fontOf(L)}"><span class="pli-fx fx-${esc(L.effect || "none")}"></span>${ex}<small>${esc(x.host?.name || "")}</small><p class="pli-ft">${esc(x.title)}</p><div style="display:grid;gap:8px;position:relative;z-index:1"><small>${esc(d)}</small><span class="pli-fb">${esc(btnText(L))}</span></div></div></div>`; }
    // art and idea: the illustrated cover
    const EA = window.EventArt, ar = x.type === "idea" ? ["4/5", "1/1", "5/6", "3/4"][hash(x.id) % 4] : "4/3", i0 = intLabel((x.tags || [])[0]);
    const e = { id: x.id, title: x.title, activity: x.art?.activity || "", coverArt: x.art?.kind ? { kind: x.art.kind, ...(x.art.tone ? { tone: x.art.tone } : {}) } : null };
    // the card's own heading carries the title, so the cover shows only its label (no title three times over)
    const cov = EA ? EA.cover(e, { title: "", label: x.type === "idea" ? (i0 ? i0.label : "Idea") : undefined }) : `<div style="display:grid;place-items:center;height:100%;font-size:44px">${esc(i0?.emoji || "✨")}</div>`;
    const vibe = x.type === "idea" && x.look ? `<div class="pli-vibe" style="${lookVars(x.look)}"><span>${esc(vibeName(x.look) || "A look to start from")}</span><i>${esc(btnText(x.look))}</i></div>` : "";
    return `<div class="pli-media pli-art" style="--ar:${ar}">${ex}${x.type === "art" && x.status !== "upcoming" ? `<span class="pli-kind">Past</span>` : "" /* review 8: "Coming up" is the sticker, never twice */}${cov}</div>${vibe}`; }

  // the line under the title, without the title again ("Saturday Run Club: a 5k" reads "A 5k")
  const lineOf = (x) => { const t = String(x.title || "").trim(), l = String(x.line || "").trim(); if (!t || !l) return l; if (l.toLowerCase() === t.toLowerCase()) return "";
    if (l.toLowerCase().startsWith(t.toLowerCase())) { const r = l.slice(t.length).replace(/^[\s:,.\-\u2013\u2014\u00b7\u2022|]+/, ""); /* "Title · $45 a person" reads "$45 a person", no stray dot */ return r ? r[0].toUpperCase() + r.slice(1) : ""; } return l.replace(/^[\s\u00b7\u2022|]+/, ""); };
  /** One card. opts: { tilt: true } (default) for the scrapbook tilt; { fade: true } to animate in. */
  function card(x, opts = {}) { if (!x?.id) return ""; css(); items.set(x.id, x); const h = hash(x.id), tilt = opts.tilt === false ? 0 : ((h % 7) - 3) * 0.35;
    const tags = (x.tags || []).slice(0, 3).map((t) => intLabel(t)).filter(Boolean);
    const save = window.PLSave ? window.PLSave.button({ kind: x.save.kind, ref: x.save.ref, title: x.title, img: x.type === "photo" ? x.img : "" }, { icon: true }) : "";
    const real = x.real?.url && safeUrl(x.real.url) ? `<a class="pli-real" href="${esc(safeUrl(x.real.url))}">${x.status === "upcoming" ? "See the real one" : "See the real one"}</a>` : "";
    const sticker = x.status === "upcoming" && x.type !== "idea" ? `<span class="pli-sticker">Coming up</span>` : x.saves >= 3 ? `<span class="pli-sticker">♥ Saved a lot</span>` : "";
    return `<article class="pli pli-${esc(x.type)}${opts.fade ? " pli-fade" : ""}" style="--tilt:${tilt}deg" data-pli="${esc(x.id)}">${sticker}<div class="pli-card">${media(x)}
      <div class="pli-body">${x.type === "photo" ? "" : `<h3 class="pli-title${x.type === "flyer" ? " pli-sr" : ""}">${esc(x.title)}</h3>`}${lineOf(x) ? `<p class="pli-line">${esc(lineOf(x))}</p>` : ""}
        ${x.host?.handle ? `<p class="pli-by">by <a href="${esc(safeUrl(x.host.url) || "/@" + x.host.handle)}">${esc(x.host.name)}</a></p>` : ""}
        ${tags.length ? `<div class="pli-tags">${tags.map((t) => `<button type="button" data-pli-tag="${esc(t.id)}">${esc(t.label)}</button>`).join("")}</div>` : ""}
        <div class="pli-acts">${save}<button type="button" class="pli-host" data-pli-host="${esc(x.id)}">Host this</button>${real}</div>
        <p class="pli-count" data-pls-count="${esc(x.save.kind + ":" + x.save.ref)}">${esc(window.PLSave ? window.PLSave.countLine(x.saves || 0) : "")}</p>${hostedKey(x) ? `<p class="pli-count pli-hosted" data-pl-hosted="${esc(hostedKey(x))}" hidden></p>` : ""}</div></div></article>`; }
  // "3 people hosted this after seeing it" (public/hostlike.js fills it in): an idea, or the real event a card came from
  const hostedKey = (x) => (x.type === "idea" && /^idea-[A-Za-z0-9_-]{2,110}$/.test(x.id || "") ? x.id : x.save?.kind === "event" && /^[A-Za-z0-9_-]{2,80}$/.test(x.save.ref || "") ? x.save.ref : "");
  if (!document.querySelector('script[src="/hostlike.js"]')) { const s = document.createElement("script"); s.src = "/hostlike.js"; s.defer = true; (document.head || document.documentElement).appendChild(s); }

  /** "Host this": signed in, a new event from this idea; signed out, signup first and the idea waits in this browser. */
  function hostThis(id) { const x = items.get(id); try { localStorage.removeItem("pl.hostLike"); localStorage.setItem("pl.hostIdea", JSON.stringify({ id, title: x?.title || "", at: Date.now() })); } catch {}
    if (/(?:^|;\s*)encore_in=1/.test(document.cookie)) location.href = "/?app=1&idea=" + encodeURIComponent(id);
    else location.href = "/signup?mode=friends&from=idea&idea=" + encodeURIComponent(id); }
  document.addEventListener("click", (e) => { const h = e.target.closest?.("[data-pli-host]"); if (h) { e.preventDefault(); hostThis(h.dataset.pliHost); } });
  fetch("/interests.json").then((r) => r.json()).then((j) => { INT = j.interests || []; window.dispatchEvent(new CustomEvent("pl:interests", { detail: INT })); }).catch(() => {});
  window.PLInspo = { card, css, hostThis, lookVars, interests: () => INT, setInterests: (L) => { INT = L || []; }, item: (id) => items.get(id) };
})();
