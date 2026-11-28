// ---- story stickers people can tap (server/storymake.js): one drawing for the composer and the viewer ----
// An event card, "I'm in", a countdown, a host mention, a question box, a two-way poll and an emoji slider. Each is
// laid out for a slide 360 wide and scaled with the slide, so it sits in the viewer exactly where it was put.
// Loaded only when the composer opens or a story with stickers is on screen (public/storycomposer.js, public/storyview.js).
(function () {
  if (window.PLStoryKit) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const REF = 360;
  const t12 = (t) => (/^\d{1,2}:\d\d$/.test(t || "") ? (([h, m]) => { h = +h; return (h % 12 || 12) + (+m ? ":" + m : "") + (h < 12 ? "am" : "pm"); })(t.split(":")) : "");
  const dayOf = (d) => { const x = /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? new Date(d + "T12:00:00") : null; return x && !isNaN(x) ? x.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : ""; };
  const when = (s) => [dayOf(s.date), t12(s.startTime)].filter(Boolean).join(" · ");
  const G = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const ARROW = `<svg ${G} width="14" height="14"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
  const CSS = `.sk{position:absolute;left:0;top:0;transform-origin:center;box-sizing:border-box;font:500 14px/1.3 "IBM Plex Sans",system-ui,sans-serif;color:#1B1D1C;letter-spacing:0;text-align:left;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.sk *{box-sizing:border-box}.sk a,a.sk{color:inherit;text-decoration:none}
.sk-card{display:block;width:210px;background:#FAF8F3;border:1.5px solid #1B1D1C;border-radius:6px;overflow:hidden;box-shadow:0 6px 18px -8px rgba(0,0,0,.55)}
.sk-cov{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#EFEBE2;border-bottom:1.5px solid #1B1D1C}.sk-cov svg{display:block;width:100%;height:100%}
.sk-b{display:block;padding:9px 11px 10px}.sk-k{display:block;font:500 10.5px/1.2 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.04em;text-transform:uppercase;color:#444845}
.sk-t{display:block;margin-top:2px;font:600 15px/1.25 "IBM Plex Sans",system-ui,sans-serif;overflow-wrap:anywhere}
.sk-go{display:flex;align-items:center;gap:5px;margin-top:6px;font:600 12.5px/1.2 "IBM Plex Sans",system-ui,sans-serif;color:#29489A}
.sk-in{display:block;width:max-content;max-width:250px;padding:10px 16px 11px;border-radius:6px;background:#29489A;color:#fff;border:1.5px solid #1B1D1C;box-shadow:0 6px 18px -8px rgba(0,0,0,.55);text-align:center}
.sk .sk-in{color:#fff}.sk .sk-at{color:#29489A}.sk-in .sk-k{color:#E3E8F4}.sk-in b{display:flex;align-items:center;justify-content:center;gap:6px;font:600 18px/1.2 "IBM Plex Sans",system-ui,sans-serif}
.sk-cd{text-align:center}.sk-cd .sk-n{display:block;margin-top:4px;font:500 26px/1.1 "IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
.sk-at{display:block;width:max-content;max-width:260px;padding:7px 13px 8px;border-radius:6px;background:#FAF8F3;border:1.5px solid #1B1D1C;color:#29489A;font:600 17px/1.2 "IBM Plex Sans",system-ui,sans-serif;box-shadow:0 6px 18px -8px rgba(0,0,0,.55)}
.sk-q .sk-b{padding:12px}.sk-q .sk-t{text-align:center;margin:0}
.sk-fake,.sk-q input{display:block;width:100%;min-height:48px;margin-top:9px;padding:8px 10px;border:1.5px solid #CFC8B9;border-radius:6px;background:#fff;color:#444845;font:400 14px/1.2 "IBM Plex Sans",system-ui,sans-serif;text-align:center}
.sk-q input{color:#1B1D1C;text-align:left;font-size:16px}.sk-q input:focus-visible,.sk button:focus-visible,a.sk:focus-visible,.sk a:focus-visible,.sk-sl input:focus-visible{outline:3px solid #F2DD6B;outline-offset:2px}
.sk-row{display:flex;gap:6px;margin-top:8px}.sk-row>*{flex:1 1 0;min-width:0}.sk-row.done{flex-direction:column}.sk-row.done>*{flex:none}
.sk-btn{display:flex;align-items:center;justify-content:center;min-height:48px;padding:6px 4px;border:1.5px solid #1B1D1C;border-radius:6px;background:#fff;color:#1B1D1C;font:600 13.5px/1.15 "IBM Plex Sans",system-ui,sans-serif;text-align:center;overflow-wrap:break-word;cursor:pointer}
.sk-btn.pri{background:#29489A;color:#fff}.sk-btn[disabled]{opacity:.6;cursor:default}
.sk-res{position:relative;display:flex;align-items:center;justify-content:space-between;gap:6px;min-height:38px;padding:6px 9px;border:1.5px solid #1B1D1C;border-radius:6px;background:#fff;font:600 13.5px/1.15 "IBM Plex Sans",system-ui,sans-serif;overflow:hidden}
.sk-res i{position:absolute;left:0;top:0;bottom:0;background:#E3E8F4;z-index:0}.sk-res.me i{background:#F2DD6B}.sk-res span,.sk-res b{position:relative;z-index:1;overflow-wrap:anywhere}.sk-res b{font:500 13px "IBM Plex Mono",ui-monospace,monospace}
.sk-sl{display:block;position:relative;margin-top:10px;height:48px}.sk-sl input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.sk-track{position:absolute;left:0;right:0;top:21px;height:6px;border-radius:3px;background:#CFC8B9}.sk-fill{position:absolute;left:0;top:21px;height:6px;border-radius:3px;background:#29489A}
.sk-thumb{position:absolute;top:6px;width:36px;height:36px;margin-left:-18px;display:grid;place-items:center;font-size:26px;line-height:1;pointer-events:none}
.sk-avg{position:absolute;top:13px;width:3px;height:22px;margin-left:-1.5px;border-radius:2px;background:#1B1D1C}
.sk.v1 .sk-card,.sk.v1 .sk-at{background:#1B1D1C;color:#FAF8F3;border-color:#FAF8F3}.sk.v1 .sk-k,.sk.v1 .sk-s{color:#CFC8B9}.sk.v1 .sk-go,.sk.v1 .sk-at{color:#F2DD6B}.sk.v1 .sk-cov{border-color:#FAF8F3}
.sk.v1 .sk-btn,.sk.v1 .sk-res{background:#1B1D1C;color:#FAF8F3;border-color:#FAF8F3}.sk.v1 .sk-res i{background:#29489A}.sk.v1 .sk-res.me i{background:#56683F}.sk.v1 .sk-fake{background:#2B2E2C;border-color:#6B6F6C;color:#CFC8B9}.sk.v1 .sk-track{background:#6B6F6C}.sk.v1 .sk-fill{background:#F2DD6B}.sk.v1 .sk-avg{background:#FAF8F3}
.sk.v1 .sk-in{background:#1B1D1C;border-color:#FAF8F3}.sk.v1 .sk-in .sk-k{color:#F2DD6B}
.sk.v2 .sk-card{background:#F2DD6B;border-radius:16px}.sk.v2 .sk-cov{border-radius:0}.sk.v2 .sk-btn,.sk.v2 .sk-res,.sk.v2 .sk-fake{border-radius:999px}.sk.v2 .sk-k,.sk.v2 .sk-s{color:#1B1D1C}.sk.v2 .sk-go{color:#1B1D1C}.sk.v2 .sk-res.me i{background:#C2431F}.sk.v2 .sk-res.me{color:#1B1D1C}
.sk.v2 .sk-in{background:#FAF8F3;color:#29489A;border-radius:999px;padding-left:22px;padding-right:22px}.sk.v2 .sk-in .sk-k{color:#444845}.sk.v2 .sk-at{background:#29489A;color:#fff;border-radius:999px}
.sk-s{display:block;margin-top:6px;font:400 12px/1.3 "IBM Plex Sans",system-ui,sans-serif;color:#444845;text-align:center}`;
  let on = false; function css() { if (on) return; on = true; const s = document.createElement("style"); s.id = "sk-css"; s.textContent = CSS; document.head.appendChild(s); }
  /** "6d 04h 12m" until a time; "It's on" once it has come. */
  function countdown(at, now = Date.now()) { let d = Math.floor((at - now) / 1000); if (!at) return ""; if (d <= 0) return "It's on"; const D = Math.floor(d / 86400); d -= D * 86400; const h = Math.floor(d / 3600); d -= h * 3600; const m = Math.floor(d / 60), s = d - m * 60, p = (n) => String(n).padStart(2, "0");
    return D ? `${D}d ${p(h)}h ${p(m)}m` : `${p(h)}h ${p(m)}m ${p(s)}s`; }
  function cover(s) { if (s.cover) return `<img class="sk-cov" src="${esc(s.cover)}" alt="" draggable="false">`;
    const A = window.EventArt; if (!A) return `<span class="sk-cov"></span>`; const k = A.kindOf({ name: s.title, activity: s.activity }), tone = A.toneOf({ id: s.ev || "", title: s.title }, k);
    return `<span class="sk-cov" style="background:${A.PASTELS[tone]}">${A.drawing(k, A.SPOT[tone])}</span>`; }
  const pct = (res, i) => { const n = (res?.[0] || 0) + (res?.[1] || 0); return n ? Math.round(((res[i] || 0) / n) * 100) : 0; };
  /** One sticker's inside. o.live: in the viewer (links are links, buttons work); otherwise the composer's still copy. */
  function html(s, o = {}) { const live = !!o.live, tag = live && s.url ? "a" : "span", href = live && s.url ? ` href="${esc(s.url)}"` : "";
    if (s.t === "event") return `<${tag} class="sk-card"${href}${live ? ` aria-label="${esc(s.title)}, ${esc(when(s))}. See the invite"` : ""}>${cover(s)}<span class="sk-b"><span class="sk-k">${esc(when(s) || "Event")}</span><span class="sk-t">${esc(s.title)}</span><span class="sk-go">See the invite ${ARROW}</span></span></${tag}>`;
    if (s.t === "imin") return `<${tag} class="sk-in"${href}><span class="sk-k">${esc(s.title)}</span><b>${esc(s.label || "I'm in")} ${ARROW}</b></${tag}>`;
    if (s.t === "count") return `<${tag} class="sk-card sk-cd"${href}><span class="sk-b"><span class="sk-k">Counting down to</span><span class="sk-t">${esc(s.title)}</span><span class="sk-n" data-sk-count="${+s.at || 0}">${esc(countdown(+s.at || 0) || "Soon")}</span></span></${tag}>`;
    if (s.t === "mention") return `<${tag} class="sk-at"${href}${live ? ` aria-label="${esc(s.name || s.handle)}'s page"` : ""}>@${esc(s.handle)}</${tag}>`;
    if (s.t === "question") return `<span class="sk-card sk-q"><span class="sk-b"><span class="sk-t">${esc(s.prompt || "Ask me something")}</span>${!live ? `<span class="sk-fake">Type something</span>` : s.my ? `<span class="sk-s" role="status">Sent. Only ${esc(o.by || "they")} can read it.</span>` : o.own ? `<span class="sk-s">${s.n ? `${s.n} ${s.n === 1 ? "answer" : "answers"} so far` : "No answers yet"}</span>` : o.can ? `<button type="button" class="sk-fake" data-sk-ask>Type something</button>` : `<a class="sk-fake" href="/login">Sign in to answer</a>`}</span></span>`;
    if (s.t === "poll") { const done = live && (s.my != null || o.own) && s.res;
      return `<span class="sk-card"><span class="sk-b">${s.q ? `<span class="sk-t" style="text-align:center">${esc(s.q)}</span>` : ""}<span class="sk-row${done ? " done" : ""}"${done ? ` role="group" aria-label="Poll results"` : ""}>${[s.a, s.b].map((label, i) => done ? `<span class="sk-res${s.my === i ? " me" : ""}"><i style="width:${pct(s.res, i)}%"></i><span>${esc(label)}</span><b>${pct(s.res, i)}%</b></span>` : live && o.can ? `<button type="button" class="sk-btn" data-sk-vote="${i}">${esc(label)}</button>` : `<span class="sk-btn">${esc(label)}</span>`).join("")}</span>${live && !done && !o.can ? `<a class="sk-s" href="/login">Sign in to vote</a>` : done ? `<span class="sk-s">${(s.res[0] || 0) + (s.res[1] || 0)} ${(s.res[0] || 0) + (s.res[1] || 0) === 1 ? "vote" : "votes"}</span>` : ""}</span></span>`; }
    if (s.t === "slider") { const done = live && (s.my != null || o.own) && s.avg != null, v = s.my != null ? s.my : done ? s.avg : 50;
      return `<span class="sk-card"><span class="sk-b">${s.q ? `<span class="sk-t" style="text-align:center">${esc(s.q)}</span>` : ""}<span class="sk-sl"><span class="sk-track"></span><span class="sk-fill" style="width:${v}%"></span>${done ? `<span class="sk-avg" style="left:${s.avg}%" title="Average"></span>` : ""}<span class="sk-thumb" style="left:${v}%">${esc(s.emoji || "")}</span>${live && !done && o.can ? `<input type="range" min="0" max="100" value="50" aria-label="${esc(s.q || "Slide to answer")}" data-sk-slide>` : ""}</span>${done ? `<span class="sk-s">${s.n || 0} ${s.n === 1 ? "answer" : "answers"}. The line is the average.</span>` : live && !o.can ? `<a class="sk-s" href="/login">Sign in to answer</a>` : ""}</span></span>`; }
    return ""; }
  /** Put a sticker's element where its data says, on a slide W by H pixels. */
  function place(el, s, W, H) { el.style.transform = `translate(${(s.x * W).toFixed(1)}px,${(s.y * H).toFixed(1)}px) translate(-50%,-50%) rotate(${s.r || 0}deg) scale(${((W / REF) * (s.s || 1)).toFixed(4)})`; }
  /** Keep every countdown under root ticking. Returns a stop function. */
  function tick(root) { const run = () => root.querySelectorAll("[data-sk-count]").forEach((n) => { const t = countdown(+n.dataset.skCount) || "Soon"; if (n.textContent !== t) n.textContent = t; }); run(); const iv = setInterval(run, 1000); return () => clearInterval(iv); }
  const LABEL = { event: "Event", imin: "I'm in", count: "Countdown", mention: "Mention", question: "Question", poll: "Poll", slider: "Slider" };
  window.PLStoryKit = { html, place, css, countdown, tick, when, REF, LABEL, REACTIONS: ["🔥", "😍", "🥟", "🙌"] };
})();
