// The swipe deck: a first visit to /feed, before the feed itself. One full-screen card at a time: real upcoming events
// in the visitor's city first, then ideas to try and photos from hosts' pages (GET /api/public/deck). "Save" saves
// the card (public/save.js: on the account, or in this browser and sent at signup) and trains the interests
// (public/interests.js); "Pass" skips. Touch swipe, the two buttons, or the arrow keys. After 5 cards: "Your 3 picks are
// saved. Make a free account to keep them." Signed in, it closes straight into the feed. "Pick topics instead" opens
// the old picker. Shown once per browser (pl.deckDone), and never to someone who already picked interests.
(function () {
  if (window.PLDeck) return;
  const DONE = "pl.deckDone", SWIPES = 5;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const safeImg = (u) => (/^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "") || /^\/presets\/[a-z0-9][a-z0-9_-]{0,70}\.(?:jpg|jpeg|png|webp)$/i.test(u || "") ? u : "");
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const t12 = (t) => (/^\d{1,2}:\d\d$/.test(t || "") ? (([h, m]) => { h = +h; return (h % 12 || 12) + (+m ? ":" + m : "") + (h < 12 ? "am" : "pm"); })(t.split(":")) : "");
  const dayOf = (d) => { const x = /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? new Date(d + "T12:00:00") : null; return x && !isNaN(x) ? x.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : ""; };
  const add = (src) => new Promise((res) => { if (document.querySelector(`script[src="${src}"]`)) { const t = setInterval(() => { if (src === "/interests.js" ? window.PLInterests : window.PLSave) { clearInterval(t); res(); } }, 50); setTimeout(() => { clearInterval(t); res(); }, 3000); return; } const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = res; document.head.appendChild(s); });
  function cityNow() { let c = ""; try { c = (window.EncorePlace?.get() || {}).city || ls.get("encore.city") || ""; } catch {} if (!c) try { c = (JSON.parse(ls.get("pl.interests") || "null") || {}).city || ""; } catch {} return String(c || "").slice(0, 60); }
  function tint(c) { const p = (c.look?.palette || []).find((x) => /^#[0-9a-f]{6}$/i.test(x)), A = window.EventArt; if (p) return p;
    if (!A) return "#FDE6A6"; const e = { id: c.art?.id || c.key, title: c.title, name: c.title, activity: c.art?.activity || "" }; return A.PASTELS[c.art?.coverArt?.tone] || A.PASTELS[A.toneOf(e, c.art?.coverArt?.kind || A.kindOf(e))] || "#FDE6A6"; }
  const dark = (hex) => { const n = parseInt(String(hex).slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 110; };
  function media(c) { const img = safeImg(c.img); if (img) return `<img src="${esc(img)}" alt="" decoding="async">`; const A = window.EventArt;
    // one chubby drawing of the event's own kind, big in the middle of the card (the Card deck look in looks.js draws it the same way)
    const e = { id: c.art?.id || c.key, title: c.title, name: c.title, activity: c.art?.activity || "", coverArt: c.art?.coverArt || undefined };
    if (!A) return `<span class="sd-fb" aria-hidden="true">✨</span>`; let k = ""; try { k = String((A.valid?.(e.coverArt?.kind) && e.coverArt.kind) || A.kindOf(e)).split("+")[0]; } catch {}
    return A.cover(e, k ? { title: "", label: "", kind: k, exact: true } : { title: "", label: "" }); }
  function avatar(h) { if (!h) return ""; const u = /^\/(?:_blob\/[A-Za-z0-9]{20}|presets\/[a-z0-9-]+\.(?:svg|jpg|png))$/.test(h.avatarUrl || "") ? h.avatarUrl : "";
    const inner = u ? `<img src="${esc(u)}" alt="">` : h.avatarArt && window.EncoreAvatars ? window.EncoreAvatars.svg(h.avatarArt, h.color || "#E26D8E", 30) : esc(h.emoji || "🙂"); return `<span class="sd-av" style="--c:${esc(h.color || "#E26D8E")}" aria-hidden="true">${inner}</span>`; }
  const meta = (c) => [c.kind === "event" ? [dayOf(c.when), t12(c.startTime)].filter(Boolean).join(" · ") : "", c.where, c.price].filter(Boolean).join(" · ");
  const hostLine = (c) => (c.kind === "event" && c.host ? `${avatar(c.host)}<span><b>${esc(c.host.name)}</b> is hosting</span>` : c.kind === "host" && c.host ? `${avatar(c.host)}<span>From <b>${esc(c.host.name)}</b></span>` : c.kind === "idea" ? `<span class="sd-idea" aria-hidden="true">💡</span><span>An idea to try</span>` : "");
  // playing-card deck: flat pastels in turn, the event's kind in the corners (top-left, and upside down bottom-right)
  const DECK = ["#EEF0B4", "#DCC3EC", "#BFE4EA", "#C8EBCF", "#F6CBD5", "#F8DDB8"];
  function corner(c) { const A = window.EventArt; let w = "";
    try { if (A && c.kind !== "host") { const e = { id: c.art?.id || c.key, title: c.title, name: c.title, activity: c.art?.activity || "" }; w = A.labelOf(c.art?.coverArt?.kind || A.kindOf(e), e) || ""; } } catch {}
    return String(w || (c.kind === "idea" ? "Idea" : c.kind === "host" ? "Host" : "Event")).replace(/[^\p{L}\p{N}&' -]/gu, "").trim().split(/\s+/).reduce((o, x) => (!o || (o + " " + x).length <= 14 ? (o ? o + " " + x : x) : o), "").slice(0, 14); }
  // owner feedback: only the top-left word, and only on drawn cards (no upside-down copy, no "Host" on photo cards)
  function cardHTML(c, i) { const ph = !!safeImg(c.img), bg = ph ? tint(c) : DECK[i % DECK.length], d = ph && dark(bg), cw = ph || c.kind === "host" ? "" : esc(corner(c));
    return `<article class="sd-card${d ? " dark" : ""}" data-i="${i}" style="--bg:${bg}" aria-label="${esc(c.title)}">
      ${cw ? `<span class="sd-corner" aria-hidden="true">${cw}</span>` : ""}<div class="sd-media${safeImg(c.img) ? " ph" : " art"}">${media(c)}<span class="sd-stamp yes" aria-hidden="true">Save</span><span class="sd-stamp no" aria-hidden="true">Pass</span>${c.badge ? `<span class="sd-badge${c.example ? " ex" : ""}">${esc(c.badge)}</span>` : ""}</div>
      <div class="sd-body"><p class="sd-host">${hostLine(c)}</p><h3>${esc(c.title)}</h3>${meta(c) ? `<p class="sd-meta">${esc(meta(c))}</p>` : ""}${c.line && c.kind !== "event" ? `<p class="sd-line">${esc(c.line)}</p>` : c.going ? `<p class="sd-line">${esc(c.going)} in so far</p>` : ""}</div></article>`; }

  const CSS = `.sd{position:fixed;inset:0;z-index:2147482990;background:#F7F1E8;color:#1F1A17;font:16px/1.45 "Instrument Sans",system-ui,sans-serif;display:flex;justify-content:center;overflow:hidden;animation:sdIn .3s ease}
.sd::before{content:"";position:absolute;inset:0;background:radial-gradient(rgba(102,90,81,.12) 1px,transparent 1.3px) 0 0/10px 10px;pointer-events:none}
@keyframes sdIn{from{opacity:0}}
.sd-in{position:relative;width:min(100%,460px);height:100%;display:flex;flex-direction:column;padding:calc(10px + env(safe-area-inset-top)) 16px calc(12px + env(safe-area-inset-bottom))}
.sd-top{display:flex;align-items:flex-start;gap:10px}.sd-top>div{flex:1;min-width:0}
.sd-top h2{margin:2px 0 0;font:600 clamp(26px,7vw,32px)/1.05 var(--sys-display)}.sd-top h2 em{font-style:normal;color:#C94A30}.sd-top p{margin:4px 0 0;color:#665A51;font-size:14.5px}
.sd-x{flex:none;width:44px;height:44px;border-radius:50%;border:1.5px solid #D9CCBB;background:#fff;display:grid;place-items:center;padding:0;cursor:pointer;color:#5A3B2B}.sd-x svg{width:18px;height:18px}
.sd-dots{display:flex;gap:6px;margin:12px 0 4px}.sd-dots i{flex:1;height:6px;border-radius:6px;background:#E4D9C8;border:0;transition:background .25s}.sd-dots i.on{background:#C94A30}.sd-dots i.cur{background:#F2D48F}
.sd-stack{position:relative;flex:1;min-height:0;margin:10px 6px 30px}
.sd-card{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg);border:1.5px solid rgba(31,26,23,.18);border-radius:24px;box-shadow:0 1px 2px rgba(31,26,23,.06),0 10px 28px -16px rgba(31,26,23,.28);overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;transform-origin:50% 90%;transition:transform .32s cubic-bezier(.3,1.3,.5,1),opacity .25s;will-change:transform}
.sd-card[data-pos="1"]{transform:translateY(10px) scale(.96);z-index:2}.sd-card[data-pos="2"]{transform:translateY(18px) scale(.92);z-index:1}.sd-card[data-pos="0"]{z-index:3;cursor:grab}.sd-card[data-pos="h"]{opacity:0;pointer-events:none;transform:scale(.88)}
.sd-card.drag{transition:none;cursor:grabbing}.sd-card.drag .sd-badge{opacity:0}
.sd-media{position:relative;flex:1;min-height:0;margin:10px 10px 0;border:1.5px solid rgba(31,26,23,.18);border-radius:16px;overflow:hidden;background:#fff}.sd-media>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none}.sd-media .ea-cover{border-radius:13px}
.sd-corner{position:absolute;left:20px;top:16px;z-index:3;font:700 15px/1 "Instrument Sans",system-ui;letter-spacing:.24em;text-transform:uppercase;color:#1F1A17;pointer-events:none}.sd-card.dark .sd-corner{color:#FFF8EE}
.sd-media.art{margin:40px 8px 0;border:0;background:transparent}.sd-media.art .ea-cover{background:transparent!important;border-radius:0}.sd-media.art .ea-cover .ea-txt{display:none}
.sd-media.art .ea-art{inset:0 2% 2%!important;width:auto!important;height:auto!important;max-width:none!important;justify-content:center!important;align-items:center!important}.sd-media.art .ea-art svg{width:100%!important;height:100%!important;max-width:none!important;overflow:visible}.sd-media.art .ea-art svg [stroke-width]{stroke-width:6px}
.sd-fb{position:absolute;inset:0;display:grid;place-items:center;font-size:64px}
.sd-badge{position:absolute;right:10px;top:12px;z-index:3;font:700 13px/1 "Instrument Sans",system-ui;padding:7px 11px;border-radius:999px;background:#F2D48F;border:0}.sd-badge.ex{background:#fff;color:#5A4E45}
.sd-stamp{position:absolute;top:22px;z-index:4;font:700 30px/1 var(--sys-display);letter-spacing:.02em;padding:6px 14px;border:4px solid currentColor;border-radius:12px;background:rgba(255,255,255,.88);opacity:0;pointer-events:none}
.sd-stamp.yes{right:16px;color:#3E6B34;transform:rotate(12deg)}.sd-stamp.no{left:16px;color:#A63A22;transform:rotate(-12deg)}
.sd-body{flex:none;padding:12px 16px 16px;color:#1F1A17}.sd-card.dark .sd-body{color:#FFF8EE}.sd-card.dark .sd-meta,.sd-card.dark .sd-line,.sd-card.dark .sd-host{color:rgba(255,248,238,.85)}
.sd-host{display:flex;align-items:center;gap:8px;margin:0;font-size:14px;color:#5A4E45}.sd-host b{font-weight:700}
.sd-av{flex:none;width:30px;height:30px;border-radius:50%;border:1.5px solid rgba(31,26,23,.18);overflow:hidden;display:grid;place-items:center;background:color-mix(in srgb,var(--c) 22%,#fff);font-size:15px}.sd-av img,.sd-av svg{width:100%;height:100%;object-fit:cover}
.sd-idea{font-size:20px}
.sd-body h3{margin:6px 0 2px;font:600 clamp(24px,6.6vw,30px)/1.08 var(--sys-display);text-wrap:balance;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sd-meta{margin:0;font-size:15px;color:#5A4E45;font-weight:600}.sd-line{margin:4px 0 0;font-size:14.5px;color:#5A4E45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sd-acts{display:flex;justify-content:center;align-items:center;gap:18px;padding:6px 0 4px}
.sd-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:56px;border-radius:999px;border:1.5px solid #D9CCBB;font:600 17px "Instrument Sans",system-ui;cursor:pointer;transition:background .12s;color:#1F1A17;background:#fff}
.sd-btn:active{background:#F7F1E8}.sd-no{width:56px;padding:0;color:#5A3B2B}.sd-no svg{width:20px;height:20px}.sd-yes{min-width:180px;padding:0 26px;background:#C94A30;border-color:#C94A30;color:#fff}.sd-yes:active{background:#B04A30}.sd-yes svg{width:22px;height:22px}
.sd:focus{outline:none}.sd-btn:focus-visible,.sd-x:focus-visible,.sd-link:focus-visible,.sd-go:focus-visible{outline:3px solid #C94A30;outline-offset:3px}
.sd-foot{display:flex;justify-content:center;gap:14px;align-items:center;margin:6px 0 0;font-size:14px;color:#665A51}
.sd-link{background:none;border:0;padding:6px 2px;font:600 15px "Instrument Sans",system-ui;color:#A63A22;text-decoration:underline;cursor:pointer;min-height:40px}
.sd-keys{display:none}@media (hover:hover) and (pointer:fine){.sd-keys{display:inline}}
.sd-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.sd-end{flex:1;display:grid;align-content:center;justify-items:center;text-align:center;gap:12px;padding:10px 6px 30px}
.sd-fan{position:relative;width:250px;height:190px;margin-bottom:8px}.sd-fan span{position:absolute;top:10px;width:132px;background:#fff;border:1.5px solid rgba(31,26,23,.18);border-radius:6px;padding:7px 7px 24px;box-shadow:0 1px 2px rgba(31,26,23,.06),0 10px 28px -16px rgba(31,26,23,.28)}
.sd-fan span:nth-child(1){left:6px;transform:rotate(-9deg)}.sd-fan span:nth-child(2){left:58px;top:0;transform:rotate(3deg);z-index:2}.sd-fan span:nth-child(3){left:112px;transform:rotate(11deg)}
.sd-fan .m{position:relative;display:block;aspect-ratio:1/1;overflow:hidden;background:var(--bg,#FDE6A6)}.sd-fan .m img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.sd-fan .m .ea-txt{display:none}
.sd-fan span::before{content:"";position:absolute;top:-10px;left:50%;width:50px;height:16px;margin-left:-25px;background:#F2D48F;opacity:.92;transform:rotate(-5deg);z-index:2}
.sd-end h2{margin:0;font:600 clamp(28px,8vw,38px)/1.05 var(--sys-display);text-wrap:balance}.sd-end p{margin:0;color:#665A51;max-width:32ch}
.sd-go{display:inline-flex;align-items:center;justify-content:center;min-height:56px;padding:0 28px;border-radius:999px;border:1px solid #C94A30;background:#C94A30;color:#fff;font:600 17px "Instrument Sans",system-ui;text-decoration:none;cursor:pointer}.sd-go.ghost{background:#fff;color:#1F1A17;border:1.5px solid #D9CCBB}
.sd-end-acts{display:grid;gap:10px;justify-items:center;margin-top:6px}
.sd-potto{width:70px}.sd-potto svg{width:70px;height:auto}
@media (min-width:700px){.sd-in{padding-top:28px;padding-bottom:24px}.sd-stack{max-height:640px}}
@media (max-height:640px){.sd-top p{display:none}.sd-btn{min-height:52px}.sd-no{width:56px}}
@media (prefers-reduced-motion:reduce){.sd,.sd-card,.sd-dots i{animation:none!important;transition:none!important}}`;
  const css = () => { if (document.getElementById("sdCss")) return; const s = document.createElement("style"); s.id = "sdCss"; s.textContent = CSS; document.head.appendChild(s); };
  const HEART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.4C1.4 7.6 3.6 4 7.1 4c2.1 0 3.6 1.2 4.9 3 1.3-1.8 2.8-3 4.9-3 3.5 0 5.7 3.6 4.4 7.1-1.8 4.8-9.3 9.4-9.3 9.4z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/></svg>`;
  // round 12: drawn line glyphs for close and pass, not the × and ✕ characters
  const XG = `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15"/></svg>`;
  // round 12: the cards that match what you're into come first (the interests you picked, on this browser or your account)
  async function byInterests(cards) { let mine = []; try { if (signedIn()) { const r = await fetch("/api/me/interests", { credentials: "same-origin" }); if (r.ok) mine = (await r.json()).interests || []; } } catch {}
    if (!mine.length) try { mine = (JSON.parse(ls.get("pl.interests") || "null") || {}).interests || []; } catch {} if (!mine.length) return cards;
    let L = []; try { L = (await (await fetch("/interests.json")).json()).interests || []; } catch {}
    const words = L.filter((x) => mine.includes(x.id)).flatMap((x) => [x.id, ...(x.words || [])]).map((w) => String(w).toLowerCase()); if (!words.length) return cards;
    const score = (c) => { const t = ` ${[c.title, c.line, c.where, ...(c.tags || [])].join(" ").toLowerCase()} `; return (c.tags || []).filter((x) => mine.includes(x)).length * 3 + words.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t)).length; };
    return cards.map((c, n) => ({ c, n, s: score(c) })).sort((a, b) => b.s - a.s || a.n - b.n).map((x) => x.c); }

  let openNow = false;
  /** Show the deck. opts.cards to skip the fetch (tests); opts.onDone(picks). */
  async function open(opts = {}) { if (openNow || document.querySelector(".sd")) return; openNow = true; css();
    const city = cityNow(); let D = { cards: opts.cards || [] };
    if (!opts.cards) { try { const q = new URLSearchParams({ city }); D = await (await fetch("/api/public/deck?" + q, { credentials: "same-origin" })).json(); } catch { D = { cards: [] }; } }
    let cards = (D.cards || []).filter((c) => c && c.key && c.title); if (cards.length < 2) { openNow = false; return; } if (!opts.cards) cards = await byInterests(cards);
    add("/save.js"); const total = Math.min(SWIPES, cards.length), picks = [], tags = new Set(); let i = 0, busy = false;
    const el = document.createElement("div"); el.className = "sd"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "sdH");
    const local = D.city && D.local ? D.city : "";
    el.innerHTML = `<div class="sd-in"><header class="sd-top"><div><h2 id="sdH">Would you <em>go?</em></h2><p>${local ? `Coming up in ${esc(local)}, then ideas. ` : ""}Swipe right to save, left to pass.</p></div><button type="button" class="sd-x" aria-label="Close and see the feed">${XG}</button></header>
      <div class="sd-dots" aria-hidden="true">${Array.from({ length: total }, () => "<i></i>").join("")}</div>
      <div class="sd-stack">${cards.map(cardHTML).join("")}</div>
      <div class="sd-acts"><button type="button" class="sd-btn sd-no" aria-label="Pass">${XG}</button><button type="button" class="sd-btn sd-yes">${HEART}Save</button></div>
      <p class="sd-foot"><button type="button" class="sd-link" id="sdTopics">Pick topics instead</button><span class="sd-keys">or use ← and →</span></p>
      <p class="sd-sr" aria-live="polite" id="sdLive"></p></div>`;
    document.body.appendChild(el); const prevOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    const $ = (s) => el.querySelector(s), C = [...el.querySelectorAll(".sd-card")], live = $("#sdLive"), dots = [...el.querySelectorAll(".sd-dots i")];
    const lay = () => { C.forEach((c, k) => c.dataset.pos = k < i ? "gone" : k - i < 3 ? String(k - i) : "h"); C.forEach((c, k) => { if (k < i) c.style.display = "none"; c.setAttribute("aria-hidden", String(k !== i)); });
      dots.forEach((d, k) => { d.className = k < i ? (picks.some((p) => p.n === k) ? "on" : "") || "past" : k === i ? "cur" : ""; });
      if (i < total) live.textContent = `${i + 1} of ${total}: ${cards[i].title}`; };
    function finish(how) { if (!document.contains(el)) return; ls.set(DONE, "1"); ls.set("pl.interestsSeen", "1"); document.removeEventListener("keydown", onKey, true);
      const ids = [...tags]; add("/interests.js").then(() => { if (window.PLInterests?.train) return window.PLInterests.train(ids, city); if (ids.length || city) { let cur = {}; try { cur = JSON.parse(ls.get("pl.interests") || "{}") || {}; } catch {} ls.set("pl.interests", JSON.stringify({ interests: [...new Set([...(cur.interests || []), ...ids])].slice(0, 20), city: cur.city || city, at: Date.now() })); } }).catch(() => {});
      opts.onDone?.(picks.map((p) => p.c));
      const close = () => { el.remove(); document.body.style.overflow = prevOverflow; openNow = false; window.dispatchEvent(new CustomEvent("pl:deck-done", { detail: { picks: picks.length } })); };
      if (how === "topics") { close(); add("/interests.js").then(() => window.PLInterests?.open({ after: "visit" })); return; }
      const n = picks.length, line = n ? `Your ${n} ${n === 1 ? "pick is" : "picks are"} saved.` : "";
      if (signedIn() || how === "close") { close(); if (n && window.PLSave?.toast) window.PLSave.toast(`<b>${esc(line)}</b>${signedIn() ? "" : " Make a free account to keep them."}`, signedIn() ? { go: "/saved", goLabel: "See them", ms: 5000 } : { go: "/signup?mode=friends&from=saves", goLabel: "Make an account", ms: 7000 }); return; }
      const fan = picks.slice(0, 3).map((p) => `<span style="--bg:${tint(p.c)}"><i class="m">${media(p.c)}</i></span>`).join("");
      $(".sd-in").innerHTML = `<header class="sd-top"><div></div><button type="button" class="sd-x" aria-label="Close and see the feed">${XG}</button></header><div class="sd-end" role="status">
        ${n ? `<div class="sd-fan" aria-hidden="true">${fan}</div><h2 id="sdH">${esc(line)}</h2><p>Make a free account to keep them. We'll tell you when they're close.</p>
        <div class="sd-end-acts"><a class="sd-go" href="/signup?mode=friends&amp;from=saves">Make a free account</a><button type="button" class="sd-link" id="sdFeed">See the feed</button></div>`
        : `<span class="sd-potto" aria-hidden="true">${window.Potto ? window.Potto.svg("think", 70, "") : ""}</span><h2 id="sdH">Nothing caught your eye?</h2><p>The feed has more, or pick a few topics and we'll find better ones.</p>
        <div class="sd-end-acts"><button type="button" class="sd-go" id="sdFeed">See the feed</button><button type="button" class="sd-link" id="sdTopics2">Pick topics instead</button></div>`}</div>`;
      const fin = $(".sd-go") || $("#sdFeed"); fin?.focus({ preventScroll: true });
      $(".sd-x").onclick = close; $("#sdFeed") && ($("#sdFeed").onclick = close); $("#sdTopics2") && ($("#sdTopics2").onclick = () => { close(); add("/interests.js").then(() => window.PLInterests?.open({ after: "visit" })); });
      document.addEventListener("keydown", function esc2(e) { if (!document.contains(el)) return document.removeEventListener("keydown", esc2, true); if (e.key === "Escape") { e.preventDefault(); close(); document.removeEventListener("keydown", esc2, true); } }, true); }
    function decide(yes) { if (busy || i >= total) return; busy = true; const c = cards[i], card = C[i];
      if (yes) { picks.push({ c, n: i }); (c.tags || []).forEach((t) => tags.add(t)); add("/save.js").then(() => window.PLSave?.add?.({ kind: c.kind, ref: c.ref, title: c.title, img: safeImg(c.img) })).catch(() => {}); }
      live.textContent = yes ? `Saved: ${c.title}.` : `Passed: ${c.title}.`;
      const out = () => { i++; busy = false; if (i >= total) return finish("done"); lay(); };
      if (RM()) return out(); card.classList.remove("drag"); card.style.transition = "transform .34s ease-in,opacity .34s"; card.style.transform = `translateX(${yes ? 130 : -130}%) rotate(${yes ? 18 : -18}deg)`; card.style.opacity = "0"; setTimeout(out, 300); }
    // drag the top card: past a third of its width (or a quick flick) decides, else it springs back
    let drag = null;
    el.querySelector(".sd-stack").addEventListener("pointerdown", (e) => { const card = C[i]; if (!card || !card.contains(e.target) || e.button || busy) return; drag = { x: e.clientX, y: e.clientY, t: performance.now(), card, dx: 0 }; card.setPointerCapture?.(e.pointerId); card.classList.add("drag"); });
    el.addEventListener("pointermove", (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.dx = dx; drag.card.style.transform = `translate(${dx}px,${dy * 0.25}px) rotate(${dx / 16}deg)`;
      const o = Math.min(1, Math.abs(dx) / 90); drag.card.querySelector(".sd-stamp.yes").style.opacity = dx > 0 ? o : 0; drag.card.querySelector(".sd-stamp.no").style.opacity = dx < 0 ? o : 0; });
    const up = () => { if (!drag) return; const { dx, t, card } = drag, w = card.offsetWidth || 300, fast = Math.abs(dx) > 40 && performance.now() - t < 250; drag = null;
      if (Math.abs(dx) > w / 3 || fast) return decide(dx > 0); card.classList.remove("drag"); card.style.transform = ""; card.querySelectorAll(".sd-stamp").forEach((s) => (s.style.opacity = 0)); };
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    const onKey = (e) => { if (!document.contains(el)) return; if (e.key === "ArrowRight") { e.preventDefault(); decide(true); } else if (e.key === "ArrowLeft") { e.preventDefault(); decide(false); } else if (e.key === "Escape") { e.preventDefault(); finish("close"); }
      else if (e.key === "Tab") { const F = [...el.querySelectorAll("button,a[href]")].filter((x) => x.offsetParent !== null); const k = F.indexOf(document.activeElement); if (e.shiftKey && k <= 0) { e.preventDefault(); F.at(-1).focus(); } else if (!e.shiftKey && k === F.length - 1) { e.preventDefault(); F[0].focus(); } } };
    document.addEventListener("keydown", onKey, true);
    $(".sd-yes").onclick = () => decide(true); $(".sd-no").onclick = () => decide(false); $(".sd-x").onclick = () => finish("close"); $("#sdTopics").onclick = () => finish("topics");
    el.tabIndex = -1; lay(); el.focus({ preventScroll: true }); // the arrow keys work straight away; Tab reaches the buttons
    return { decide, finish }; }

  /** The first visit to /feed: signed out with no picks yet, or signed in with none on the account. */
  async function maybeAuto() { if (ls.get(DONE) || (location.pathname !== "/feed" && location.pathname !== "/")) return;
    if (!signedIn()) { if (ls.get("pl.interestsSeen") || ls.get("pl.interests")) return; return setTimeout(() => open(), 500); }
    try { const r = await fetch("/api/me/interests", { credentials: "same-origin" }); if (!r.ok) return; const j = await r.json(); if (j.interests?.length || j.city) { ls.set(DONE, "1"); return; } } catch { return; }
    setTimeout(() => open(), 500); }
  window.PLDeck = { open, maybeAuto, SWIPES };
})();
