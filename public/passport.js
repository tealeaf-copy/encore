// "Your scene": a guest's passport. One stamp for each event they went to (an ink stamp drawn from the event's
// illustration), the hosts they follow and the kudos they gave. It appears after a first reply or first kudos.
// Shareable as a 1080x1920 story image, like the event story cards. Private events show as a stamp with no title.
//
// For other pages: PLPassport.card(data) returns HTML for GET /api/me/passport; PLPassport.mount(el) fetches and
// draws it (nothing while it's locked); PLPassport.share(data) makes the story image.
(function () {
  if (window.PLPassport) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const INKS = ["#C94A30", "#3E6B48", "#2F4F8C", "#7A3E8C", "#B0344F", "#1F1A17"];
  const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const kindOf = (s) => { const EA = window.EventArt; if (EA?.valid?.(s.kind)) return s.kind.split("+")[0]; return EA ? EA.kindOf({ activity: s.activity, title: s.title }) : "party"; };
  const labelOf = (s, k) => { const L = window.EventArt?.LABEL || {}; return String(L[k] || s.activity || "Event").toUpperCase().slice(0, 18); };
  const when = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)} ${d.slice(0, 4)}` : "");
  /** One ink stamp as an SVG string (works as an image too: no web fonts, no outside references). */
  function stampSvg(s, size = 200) { const k = kindOf(s), ink = INKS[hash(s.eventId || s.title) % INKS.length], label = labelOf(s, k), date = when(s.date), round = hash(s.eventId) % 3 !== 0;
    let art = window.EventArt ? window.EventArt.drawing(k, ink) : ""; art = art.replace(/#151515/g, ink).replace(/fill="#fff"/g, 'fill="none"').replace(/<svg /, '<svg x="44" y="52" width="112" height="84" ');
    const id = "p" + (hash(s.eventId + label) % 1e6), shape = round ? `<circle cx="100" cy="100" r="92" fill="none" stroke="${ink}" stroke-width="7"/><circle cx="100" cy="100" r="80" fill="none" stroke="${ink}" stroke-width="2.5" stroke-dasharray="3 5"/>`
      : `<rect x="10" y="22" width="180" height="156" rx="18" fill="none" stroke="${ink}" stroke-width="7"/><rect x="22" y="34" width="156" height="132" rx="10" fill="none" stroke="${ink}" stroke-width="2.5" stroke-dasharray="3 5"/>`;
    const top = round ? `<path id="${id}t" d="M30 100a70 70 0 0 1 140 0" fill="none"/><text font-family="Arial Black,Arial,sans-serif" font-size="17" font-weight="900" letter-spacing="2" fill="${ink}" text-anchor="middle"><textPath href="#${id}t" startOffset="50%">${esc(label)}</textPath></text>`
      : `<text x="100" y="54" font-family="Arial Black,Arial,sans-serif" font-size="${label.length > 11 ? 12 : 16}" font-weight="900" letter-spacing="2" fill="${ink}" text-anchor="middle">${esc(label)}</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}" aria-hidden="true"><g opacity=".92">${shape}${top}${art}<text x="100" y="${round ? 160 : 156}" font-family="Courier New,monospace" font-size="15" font-weight="700" letter-spacing="1" fill="${ink}" text-anchor="middle">${esc(date)}</text></g></svg>`; }

  const CSS = `.pp{position:relative;max-width:760px;background:#FBF4E6;border:2.5px solid #1F1A17;border-radius:24px;box-shadow:5px 5px 0 #1F1A17;padding:18px 18px 16px;color:#1F1A17;font:15px/1.45 "Instrument Sans",system-ui,sans-serif;overflow:hidden;
  background-image:repeating-radial-gradient(circle at 110% -10%,rgba(111,127,94,.08) 0 2px,transparent 2px 14px),radial-gradient(rgba(102,90,81,.07) 1px,transparent 1.2px);background-size:auto,7px 7px}
.pp::before{content:"";position:absolute;top:-10px;left:36px;width:90px;height:24px;background:rgba(242,212,143,.92);transform:rotate(-5deg);border-radius:2px}
.pp-top{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
.pp-k{font:700 12px "Courier New",monospace;letter-spacing:.18em;color:#665A51}.pp h2{font:600 clamp(26px,5vw,34px)/1 Fredoka,system-ui;margin:2px 0 0}.pp h2 em{font-style:normal;color:#C94A30}
.pp-stats{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px}.pp-stat{background:#fff;border:2px solid #1F1A17;border-radius:14px;padding:6px 12px;transform:rotate(var(--r,0deg));box-shadow:2px 2px 0 #1F1A17}.pp-stat b{display:block;font:600 24px/1 Fredoka,system-ui}.pp-stat span{font-size:12.5px;color:#665A51;font-weight:600}
.pp-stamps{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:4px 10px;margin:10px 0 4px}
.pp-stamp{display:grid;justify-items:center;gap:0;text-decoration:none;color:inherit;transform:rotate(var(--r,0deg));mix-blend-mode:multiply}.pp-stamp svg{width:112px;height:112px}
.pp-stamp small{font:600 12.5px/1.2 "Instrument Sans",system-ui;text-align:center;max-width:120px;color:#3A302A;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pp-next{display:grid;place-items:center;width:104px;height:104px;margin:4px auto;border:2.5px dashed #B8A891;border-radius:50%;color:#8C7E70;font:600 12px/1.2 "Instrument Sans",system-ui;text-align:center;padding:10px}
.pp-hosts{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 0}.pp-hosts a{display:inline-flex;gap:5px;align-items:center;background:#fff;border:1.5px solid #1F1A17;border-radius:999px;padding:3px 10px;font:600 13px "Instrument Sans",system-ui;text-decoration:none;color:#1F1A17}
.pp h3{font:600 16px Fredoka,system-ui;margin:12px 0 2px}
.pp-share{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 16px;border:2px solid #1F1A17;border-radius:999px;background:#C94A30;color:#fff;font:600 15px "Instrument Sans",system-ui;cursor:pointer;box-shadow:2px 2px 0 #1F1A17}
.pp-cap{font:600 20px Caveat,cursive;color:#A63A22;transform:rotate(-2deg);display:inline-block}
.pp-empty{color:#665A51;margin:8px 0}
@media (max-width:520px){.pp{padding:16px 12px 14px}.pp-stamps{grid-template-columns:repeat(3,1fr);gap:2px 4px}.pp-stamp svg{width:96px;height:96px}.pp-next{width:88px;height:88px}}`;
  const css = () => { if (document.getElementById("ppCss")) return; if (![...document.querySelectorAll('link[href*="fonts.googleapis"]')].some((l) => /Caveat/.test(l.href))) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?family=Caveat:wght@600&display=swap"; document.head.appendChild(l); } const s = document.createElement("style"); s.id = "ppCss"; s.textContent = CSS; document.head.appendChild(s); };

  function card(P) { css(); if (!P) return ""; const c = P.counts || {};
    const stamps = (P.stamps || []).slice(0, 24).map((s) => `<a class="pp-stamp" style="--r:${(hash(s.eventId) % 17) - 8}deg"${s.url ? ` href="${esc(s.url)}"` : ""}>${stampSvg(s, 112)}<small>${esc(s.public ? s.title : "A private event")}</small></a>`).join("");
    const next = (P.next || []).slice(0, 3).map((s) => `<div class="pp-stamp"><span class="pp-next">Next: ${esc(s.public ? s.title : "something private")}</span></div>`).join("");
    return `<section class="pp" aria-label="Your scene"><div class="pp-top"><div><div class="pp-k">PASSPORT · POTTERY LAB</div><h2>${esc(P.first || "Your")}'s <em>scene</em></h2></div>
      <button type="button" class="pp-share" data-pp-share>📸 Share my scene</button></div>
      <div class="pp-stats"><div class="pp-stat" style="--r:-2deg"><b>${c.events || 0}</b><span>${c.events === 1 ? "event" : "events"}</span></div><div class="pp-stat" style="--r:1.5deg"><b>${c.hosts || 0}</b><span>${c.hosts === 1 ? "host followed" : "hosts followed"}</span></div><div class="pp-stat" style="--r:-1deg"><b>${c.kudos || 0}</b><span>kudos given</span></div></div>
      ${stamps || next ? `<div class="pp-stamps">${stamps}${next}</div>` : `<p class="pp-empty">Your first stamp lands the day after your first event.</p>`}
      ${(P.hosts || []).length ? `<h3>Hosts you follow</h3><div class="pp-hosts">${P.hosts.slice(0, 12).map((h) => `<a href="/@${esc(h.handle)}">${esc(h.emoji || "🙂")} ${esc(h.name)}</a>`).join("")}</div>` : ""}
      ${c.events ? `<p style="margin:10px 0 0"><span class="pp-cap">${c.events >= 5 ? "a regular, clearly" : c.events >= 2 ? "the scene is forming" : "stamp one of many"}</span></p>` : ""}</section>`; }

  // ---------- the story image ----------
  const img = (svg) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
  function wrap(x, text, cx, y, maxW, lh) { const words = String(text).split(/\s+/); let line = "", n = 0; for (const w of words) { const t = line ? line + " " + w : w; if (x.measureText(t).width > maxW && line) { x.fillText(line, cx, y + n * lh); n++; line = w; } else line = t; } if (line) { x.fillText(line, cx, y + n * lh); n++; } return n; }
  async function storyBlob(P) { const W = 1080, H = 1920, c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d"); try { await document.fonts?.load?.("600 80px Fredoka"); await document.fonts?.load?.("600 60px Caveat"); } catch {}
    x.fillStyle = "#FFF8EE"; x.fillRect(0, 0, W, H); x.fillStyle = "rgba(102,90,81,.07)"; for (let i = 0; i < W; i += 14) for (let j = 0; j < H; j += 14) x.fillRect(i, j, 2, 2);
    const px = 80, py = 200, pw = W - 160, ph = 1360; x.fillStyle = "#1F1A17"; x.beginPath(); x.roundRect(px + 16, py + 16, pw, ph, 56); x.fill(); x.fillStyle = "#FBF4E6"; x.beginPath(); x.roundRect(px, py, pw, ph, 56); x.fill(); x.lineWidth = 8; x.strokeStyle = "#1F1A17"; x.stroke();
    x.save(); x.translate(px + 120, py - 6); x.rotate(-0.08); x.fillStyle = "rgba(242,212,143,.95)"; x.fillRect(0, -26, 220, 54); x.restore();
    x.fillStyle = "#665A51"; x.font = "700 30px 'Courier New', monospace"; x.textAlign = "left"; x.fillText("PASSPORT · POTTERY LAB", px + 64, py + 110);
    x.fillStyle = "#1F1A17"; x.font = "600 104px Fredoka, 'Instrument Sans', system-ui"; x.fillText(`${P.first || "My"}'s`, px + 64, py + 230); x.fillStyle = "#C94A30"; x.fillText("scene", px + 64, py + 340);
    const c0 = P.counts || {}, stats = [[c0.events || 0, c0.events === 1 ? "event" : "events"], [c0.hosts || 0, "hosts followed"], [c0.kudos || 0, "kudos given"]];
    stats.forEach(([n, l], i) => { const sx = px + 64 + i * 276, sy = py + 400; x.save(); x.translate(sx + 120, sy + 70); x.rotate([-0.03, 0.025, -0.015][i]); x.fillStyle = "#1F1A17"; x.beginPath(); x.roundRect(-116, -66, 240, 140, 28); x.fill(); x.fillStyle = "#fff"; x.beginPath(); x.roundRect(-120, -70, 240, 140, 28); x.fill(); x.lineWidth = 5; x.stroke();
      x.fillStyle = "#1F1A17"; x.textAlign = "center"; x.font = "600 64px Fredoka, system-ui"; x.fillText(String(n), 0, 6); x.fillStyle = "#665A51"; x.font = "600 28px 'Instrument Sans', system-ui"; x.fillText(l, 0, 50); x.restore(); });
    const S = (P.stamps || []).slice(0, 9); const imgs = await Promise.all(S.map((s) => img(stampSvg(s, 280))));
    imgs.forEach((im, i) => { if (!im) return; const col = i % 3, row = Math.floor(i / 3), cx = px + 150 + col * 290, cy = py + 720 + row * 250; x.save(); x.translate(cx, cy); x.rotate(((hash(S[i].eventId) % 17) - 8) * Math.PI / 180); x.globalAlpha = 0.92; x.drawImage(im, -130, -130, 260, 260); x.restore(); });
    if (!S.length) { x.fillStyle = "#8C7E70"; x.font = "600 40px 'Instrument Sans', system-ui"; x.textAlign = "center"; x.fillText("First stamp coming soon", W / 2, py + 900); }
    x.fillStyle = "#A63A22"; x.textAlign = "center"; x.font = "600 64px Caveat, cursive"; x.save(); x.translate(W / 2, py + ph + 115); x.rotate(-0.03); x.fillText(c0.events >= 5 ? "a regular, clearly" : "my scene, so far", 0, 0); x.restore();
    x.fillStyle = "#1F1A17"; x.font = "600 44px 'Instrument Sans', system-ui"; wrap(x, "Find yours on Pottery Lab", W / 2, H - 170, W - 200, 56);
    x.font = "700 60px Fredoka, system-ui"; x.fillText("pottery lab", W / 2, H - 80);
    return await new Promise((r) => c.toBlob(r, "image/png")); }
  async function share(P) { try { const blob = await storyBlob(P), file = new File([blob], "my-scene.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: "My scene" }); return; }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "my-scene.png"; document.body.appendChild(a); a.click(); a.remove(); window.PLSave?.toast?.("Saved the image. Add it to your story."); }
    catch (e) { if (e?.name !== "AbortError") window.PLSave?.toast?.("Couldn't make the image. Try again."); } }
  let last = null;
  document.addEventListener("click", (e) => { if (e.target.closest?.("[data-pp-share]") && last) { e.preventDefault(); share(last); } });
  /** Fetch and draw the passport into el; nothing when locked (opts.teaser shows a line instead). */
  async function mount(el, opts = {}) { if (!el) return null; const r = await fetch("/api/me/passport", { credentials: "same-origin" }).catch(() => null); if (!r?.ok) { el.hidden = true; return null; }
    const P = await r.json(); last = P; if (!P.unlocked) { if (opts.teaser) { css(); el.innerHTML = `<section class="pp"><div class="pp-k">PASSPORT · POTTERY LAB</div><h2>Your <em>scene</em> starts here</h2><p class="pp-empty">Reply I'm in to an event or send a host kudos, and your first stamp lands here.</p><a href="/events" class="pp-share" style="text-decoration:none">Find something</a></section>`; el.hidden = false; } else el.hidden = true; return P; }
    el.innerHTML = card(P); el.hidden = false; return P; }
  window.PLPassport = { card, mount, share, storyBlob, stampSvg, css, set: (P) => { last = P; } };
})();
