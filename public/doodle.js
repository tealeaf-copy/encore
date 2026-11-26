// The drawing pad: hosts draw their own cover art and icons by hand. Brushes, a playful palette, paper colours,
// stickers to stamp (emoji and Potto), undo and clear. Returns a PNG blob; the caller uploads it.
//   Doodle.open({ shape: "cover" | "icon", title, onDone: async (blob) => {...} })
(function () {
  const COLORS = ["#1F1A17", "#D2603A", "#E8835C", "#F2D48F", "#8EC5E8", "#3E9C6E", "#C9B6F2", "#F7A9B6", "#FFFFFF"];
  const PAPERS = ["#FFF8EE", "#FFE6D3", "#E9F4EC", "#E6F0FA", "#F3ECFA", "#1F1A17"];
  const STAMPS = ["🏺", "✨", "🌸", "🍰", "☕", "🏃", "🎨", "💛", "🍜", "🌿", "🎉", "⭐"];
  const SIZES = [4, 10, 22];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const CSS = `.dd-bg{position:fixed;inset:0;background:rgba(31,26,23,.55);z-index:2147482000;display:grid;place-items:center;padding:12px}
.dd{background:#FFF8EE;border-radius:24px;border:2.5px solid #1F1A17;box-shadow:0 0 0 5px #fff,0 18px 50px -20px rgba(0,0,0,.6);width:min(940px,100%);max-height:calc(100vh - 24px);overflow:auto;padding:14px;display:grid;gap:10px;font:16px/1.4 "IBM Plex Sans",system-ui,sans-serif;color:#1F1A17}
.dd-h{display:flex;justify-content:space-between;align-items:center;gap:10px}.dd-h b{font:700 20px var(--pl-font-text)}.dd-h small{color:#6B5F56}
.dd-stage{position:relative;border-radius:16px;overflow:hidden;border:2px solid #1F1A17;background:#fff;touch-action:none}.dd-stage canvas{display:block;width:100%;height:auto;cursor:crosshair}
.dd-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.dd-g{display:flex;gap:5px;align-items:center;padding:5px 7px;border:1.5px solid #E4D9C8;border-radius:999px;background:#fff}
.dd-g button{border:0;background:none;cursor:pointer;border-radius:999px;display:grid;place-items:center;min-width:30px;height:30px;font-weight:600;font-size:13px;font-family:inherit;color:#1F1A17}
.dd-g button[aria-pressed=true]{outline:2.5px solid #1F1A17;outline-offset:1px}
.dd-sw{width:24px!important;min-width:24px!important;height:24px!important;border:1.5px solid rgba(0,0,0,.25)!important}
.dd-dot{border-radius:50%;background:#1F1A17;display:block}
.dd-st button{font-size:20px}
.dd-f{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center}.dd-f .btn{border-radius:999px;padding:10px 18px;font-weight:600;font-size:16px;font-family:inherit;cursor:pointer;border:1.5px solid #1F1A17;background:#fff}.dd-f .go{background:#D2603A;color:#fff;border-color:#D2603A}
.dd-hint{font-size:13px;color:#6B5F56}`;
  function ensureCss() { if (document.getElementById("ddCss")) return; const s = document.createElement("style"); s.id = "ddCss"; s.textContent = CSS; document.head.appendChild(s); }

  function open({ shape = "cover", title = "Draw your own", onDone } = {}) {
    ensureCss(); document.getElementById("ddBg")?.remove();
    const W = shape === "icon" ? 900 : 1600, H = shape === "icon" ? 900 : 1000;
    const bg = document.createElement("div"); bg.id = "ddBg"; bg.className = "dd-bg";
    bg.innerHTML = `<div class="dd" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="dd-h"><div><b>${esc(title)}</b><br><small>${shape === "icon" ? "Your own little icon. It shows on your page and next to your name." : "Draw anything. Stamps and Potto help if you're stuck."}</small></div><button type="button" class="btn" data-x aria-label="Close" style="border:0;background:none;font-size:20px;cursor:pointer">✕</button></div>
      <div class="dd-stage" style="max-width:${shape === "icon" ? "520px" : "100%"};margin:0 auto;width:100%"><canvas width="${W}" height="${H}" aria-label="Drawing area"></canvas></div>
      <div class="dd-tools">
        <div class="dd-g" role="group" aria-label="Tool"><button type="button" data-tool="pen" aria-pressed="true" title="Brush">✏️</button><button type="button" data-tool="marker" aria-pressed="false" title="Marker">🖍️</button><button type="button" data-tool="erase" aria-pressed="false" title="Eraser">🧽</button><button type="button" data-tool="stamp" aria-pressed="false" title="Stickers">⭐</button></div>
        <div class="dd-g" role="group" aria-label="Brush size">${SIZES.map((z, i) => `<button type="button" data-size="${z}" aria-pressed="${i === 1}" title="Size ${i + 1}"><span class="dd-dot" style="width:${4 + i * 5}px;height:${4 + i * 5}px"></span></button>`).join("")}</div>
        <div class="dd-g" role="group" aria-label="Color">${COLORS.map((c, i) => `<button type="button" class="dd-sw" data-color="${c}" aria-pressed="${i === 0}" style="background:${c}" aria-label="Color ${c}"></button>`).join("")}</div>
        <div class="dd-g" role="group" aria-label="Paper">${PAPERS.map((c) => `<button type="button" class="dd-sw" data-paper="${c}" style="background:${c}" aria-label="Paper ${c}"></button>`).join("")}<small style="padding:0 4px;color:#6B5F56">paper</small></div>
        <div class="dd-g dd-st" role="group" aria-label="Stickers" hidden>${STAMPS.map((e) => `<button type="button" data-stamp="${e}">${e}</button>`).join("")}${window.Potto ? `<button type="button" data-stamp="potto" title="Potto">${window.Potto.svg("cheer", 30, "Potto")}</button>` : ""}</div>
        <div class="dd-g"><button type="button" data-undo title="Undo">↶ Undo</button><button type="button" data-clear title="Clear">Clear</button></div>
      </div>
      <div class="dd-f"><span class="dd-hint" aria-live="polite">Tip: pick ⭐ to stamp stickers, tap to place them.</span><span><button type="button" class="btn" data-x>Cancel</button> <button type="button" class="btn go" data-done>Use my drawing</button></span></div></div>`;
    document.body.appendChild(bg);
    const cv = bg.querySelector("canvas"), x = cv.getContext("2d"), hint = bg.querySelector(".dd-hint");
    let tool = "pen", size = SIZES[1], color = COLORS[0], paper = PAPERS[0], stamp = "✨", drawing = false, last = null, dirty = false; const undo = [];
    const fillPaper = () => { x.save(); x.globalCompositeOperation = "destination-over"; x.fillStyle = paper; x.fillRect(0, 0, W, H); x.restore(); };
    x.fillStyle = paper; x.fillRect(0, 0, W, H);
    const snap = () => { try { undo.push(x.getImageData(0, 0, W, H)); if (undo.length > 25) undo.shift(); } catch {} };
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, p: e.pressure && e.pressure !== 0.5 ? e.pressure : 0.6 }; };
    const scale = W / 600;
    const seg = (a, b) => { x.save(); x.lineCap = "round"; x.lineJoin = "round";
      if (tool === "erase") { x.globalCompositeOperation = "source-over"; x.strokeStyle = paper; x.lineWidth = size * scale * 2.2; }
      else if (tool === "marker") { x.globalAlpha = 0.55; x.strokeStyle = color; x.lineWidth = size * scale * 1.8; }
      else { x.strokeStyle = color; x.lineWidth = size * scale * (0.7 + b.p * 0.6); }
      x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); x.restore(); };
    const placeStamp = async (p) => { snap(); dirty = true; const z = (size * 7 + 40) * scale;
      if (stamp === "potto" && window.Potto) { const svg = window.Potto.svg("cheer", 200).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '); const img = new Image(); img.onload = () => { x.drawImage(img, p.x - z, p.y - z, z * 2, z * 2); }; img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); return; }
      x.save(); x.font = `${z * 1.6}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; x.textAlign = "center"; x.textBaseline = "middle"; x.translate(p.x, p.y); x.rotate((Math.random() - 0.5) * 0.4); x.fillText(stamp, 0, 0); x.restore(); };
    cv.addEventListener("pointerdown", (e) => { e.preventDefault(); const p = pos(e); if (tool === "stamp") { placeStamp(p); return; } cv.setPointerCapture(e.pointerId); snap(); drawing = true; last = p; seg(p, { ...p, x: p.x + 0.1 }); dirty = true; });
    cv.addEventListener("pointermove", (e) => { if (!drawing) return; const p = pos(e); seg(last, p); last = p; });
    const end = () => { drawing = false; last = null; }; cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end); cv.addEventListener("pointerleave", end);
    const press = (sel, el) => { bg.querySelectorAll(sel).forEach((b) => b.setAttribute("aria-pressed", String(b === el))); };
    bg.addEventListener("click", async (e) => { const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.x != null) { if (dirty && !confirm("Leave without using your drawing?")) return; bg.remove(); return; }
      if (b.dataset.tool) { tool = b.dataset.tool; press("[data-tool]", b); bg.querySelector(".dd-st").hidden = tool !== "stamp"; hint.textContent = tool === "stamp" ? "Pick a sticker, then tap the drawing to place it. Bigger size = bigger sticker." : tool === "erase" ? "Erasing paints with your paper color." : "Draw with your finger, mouse or pen."; }
      if (b.dataset.size) { size = +b.dataset.size; press("[data-size]", b); }
      if (b.dataset.color) { color = b.dataset.color; press("[data-color]", b); if (tool === "erase" || tool === "stamp") { tool = "pen"; press("[data-tool]", bg.querySelector('[data-tool="pen"]')); bg.querySelector(".dd-st").hidden = true; } }
      if (b.dataset.stamp) { stamp = b.dataset.stamp; press("[data-stamp]", b); }
      if (b.dataset.paper) { snap(); const img = x.getImageData(0, 0, W, H), old = paper; paper = b.dataset.paper; // recolour the old paper to the new one
        const o = [parseInt(old.slice(1, 3), 16), parseInt(old.slice(3, 5), 16), parseInt(old.slice(5, 7), 16)], n = [parseInt(paper.slice(1, 3), 16), parseInt(paper.slice(3, 5), 16), parseInt(paper.slice(5, 7), 16)], D = img.data;
        for (let i = 0; i < D.length; i += 4) if (Math.abs(D[i] - o[0]) < 4 && Math.abs(D[i + 1] - o[1]) < 4 && Math.abs(D[i + 2] - o[2]) < 4) { D[i] = n[0]; D[i + 1] = n[1]; D[i + 2] = n[2]; } x.putImageData(img, 0, 0); }
      if (b.dataset.undo != null) { const u = undo.pop(); if (u) x.putImageData(u, 0, 0); }
      if (b.dataset.clear != null) { snap(); x.fillStyle = paper; x.fillRect(0, 0, W, H); dirty = false; }
      if (b.dataset.done != null) { if (!dirty) { hint.textContent = "Draw something first. Even a squiggle counts."; return; } fillPaper(); b.disabled = true; b.textContent = "Saving…";
        cv.toBlob(async (blob) => { try { await onDone?.(blob); bg.remove(); } catch (err) { hint.textContent = err?.message || "Couldn't save that. Try again."; b.disabled = false; b.textContent = "Use my drawing"; } }, "image/png"); } });
    return bg;
  }
  /** Upload a drawing as an image the page can use. Returns its URL. */
  async function upload(blob) { const r = await fetch("/api/assets", { method: "POST", headers: { "Content-Type": "image/png" }, body: blob }); const j = await r.json().catch(() => ({})); if (!r.ok || !j.url) throw new Error(j.message || "Couldn't save your drawing."); return j.url; }
  window.Doodle = { open, upload };
})();
