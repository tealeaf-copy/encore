// Save: a heart sticker for events (coming up or past), ideas and hosts, anywhere on Pottery Lab.
// Signed in: saved on the account (/api/me/saves), with optional boards. Signed out: saved in this browser, then sent
// to the account at signup ("Your 5 saves came with you"). Counts ("Saved 24 times") come from accounts only.
//
// For other pages (the feed, cards): PLSave.button({ kind: "event" | "idea" | "host", ref, title, img }) returns the
// button's HTML; clicks are handled here. PLSave.countLine(n) gives "Saved 24 times" (empty for 0).
(function () {
  if (window.PLSave) return;
  const LS = "pl.saves", esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const read = () => { try { const L = JSON.parse(localStorage.getItem(LS) || "[]"); return Array.isArray(L) ? L : []; } catch { return []; } };
  const write = (L) => { try { localStorage.setItem(LS, JSON.stringify(L.slice(0, 200))); } catch {} };
  const key = (x) => `${x.kind}:${x.ref}`;
  let server = null, boards = [], loading = null; const subs = new Set();
  const emit = () => { for (const f of subs) { try { f(); } catch {} } paintAll(); };
  async function load(force) { if (!signedIn()) { server = null; return null; } if (server && !force) return server; if (loading && !force) return loading;
    loading = fetch("/api/me/saves", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!j) { server = null; return null; } server = new Map(j.items.map((i) => [key(i), i])); boards = j.boards || []; return server; }).catch(() => null).finally(() => { loading = null; });
    return loading; }
  const isSaved = (kind, ref) => (server ? server.has(`${kind}:${ref}`) : read().some((x) => x.kind === kind && x.ref === ref));

  // ---------- look ----------
  const CSS = `.pls-btn{--pls-fill:#fff;position:relative;display:inline-flex;align-items:center;gap:6px;min-height:40px;min-width:40px;padding:0 10px 0 8px;border:2px solid #1F1A17;border-radius:999px;background:#fff;color:#1F1A17;font:600 14px "Instrument Sans",system-ui,sans-serif;cursor:pointer;box-shadow:2px 2px 0 #1F1A17;transition:transform .18s cubic-bezier(.3,1.6,.5,1),box-shadow .18s}
.pls-btn:hover{transform:translate(-1px,-1px) rotate(-3deg);box-shadow:3px 3px 0 #1F1A17}.pls-btn:active{transform:translate(1px,1px);box-shadow:0 0 0 #1F1A17}
.pls-btn svg{width:22px;height:22px;flex:none;overflow:visible}.pls-btn svg path{fill:var(--pls-fill);stroke:#1F1A17;stroke-width:2.2;stroke-linejoin:round;transition:fill .2s}
.pls-btn[aria-pressed=true]{--pls-fill:#C94A30;background:#FFF1D2}.pls-btn.pls-icon{padding:0;width:44px;height:44px;justify-content:center}.pls-btn.pls-icon .pls-t{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.pls-btn.pls-pop svg{animation:plsPop .45s cubic-bezier(.3,1.8,.5,1)}@keyframes plsPop{0%{transform:scale(1)}35%{transform:scale(1.45) rotate(-12deg)}100%{transform:scale(1)}}
.pls-btn:focus-visible{outline:3px solid #C94A30;outline-offset:2px}
.pls-toast{position:fixed;left:50%;bottom:calc(92px + env(safe-area-inset-bottom));transform:translateX(-50%) rotate(-1deg);z-index:9000;width:min(92vw,420px);background:#FFFDF8;border:2px solid #1F1A17;border-radius:18px;box-shadow:4px 4px 0 #1F1A17;padding:12px 14px;display:flex;gap:10px;align-items:center;font:500 15px/1.35 "Instrument Sans",system-ui,sans-serif;color:#1F1A17;animation:plsIn .35s cubic-bezier(.3,1.5,.5,1)}
.pls-toast::before{content:"";position:absolute;top:-11px;left:24px;width:64px;height:20px;background:rgba(242,212,143,.92);transform:rotate(-4deg);border-radius:2px}
.pls-toast b{font-family:Fredoka,"Instrument Sans",system-ui,sans-serif;font-weight:600}.pls-toast .pls-go{margin-left:auto;flex:none;background:#C94A30;color:#fff;border:2px solid #1F1A17;border-radius:999px;padding:8px 12px;font:600 14px "Instrument Sans",system-ui;text-decoration:none;white-space:nowrap}
.pls-toast .pls-x{flex:none;background:none;border:0;font-size:20px;line-height:1;cursor:pointer;color:#665A51;min-width:32px;min-height:32px}
@keyframes plsIn{from{transform:translateX(-50%) translateY(20px) rotate(-1deg);opacity:0}}
@media (min-width:861px){.pls-toast{bottom:28px}}
.pls-menu{position:fixed;z-index:9001;width:240px;background:#FFFDF8;border:2px solid #1F1A17;border-radius:16px;box-shadow:4px 4px 0 #1F1A17;padding:8px;display:grid;gap:4px;font:500 15px "Instrument Sans",system-ui}
.pls-menu b{font:600 15px Fredoka,system-ui;padding:4px 8px}.pls-menu button{text-align:left;background:none;border:0;border-radius:10px;padding:9px 10px;font:inherit;color:#1F1A17;cursor:pointer;min-height:40px}.pls-menu button:hover,.pls-menu button[aria-current]{background:#FFF1D2}
.pls-menu form{display:flex;gap:6px;padding:4px}.pls-menu input{flex:1;min-width:0;border:1.5px solid #DCCFBE;border-radius:10px;padding:8px;font:inherit;font-size:16px}.pls-menu form button{background:#1F1A17;color:#fff;text-align:center;padding:8px 10px}
@media (prefers-reduced-motion:reduce){.pls-btn,.pls-btn svg,.pls-toast{animation:none!important;transition:none!important}}`;
  const css = () => { if (document.getElementById("plsCss")) return; const s = document.createElement("style"); s.id = "plsCss"; s.textContent = CSS; document.head.appendChild(s); };
  const HEART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.4C1.4 7.6 3.6 4 7.1 4c2.1 0 3.6 1.2 4.9 3 1.3-1.8 2.8-3 4.9-3 3.5 0 5.7 3.6 4.4 7.1-1.8 4.8-9.3 9.4-9.3 9.4z"/></svg>`;
  const countLine = (n) => (n > 0 ? `Saved ${n} ${n === 1 ? "time" : "times"}` : "");
  /** The Save button. opts: { icon: true } for a round heart only; { label } to change the word. */
  function button(item, opts = {}) { css(); if (!item?.kind || !item?.ref) return ""; const on = isSaved(item.kind, item.ref);
    return `<button type="button" class="pls-btn${opts.icon ? " pls-icon" : ""}" data-pls-kind="${esc(item.kind)}" data-pls-ref="${esc(item.ref)}" data-pls-title="${esc(item.title || "")}" data-pls-img="${esc(item.img || "")}" aria-pressed="${on}" aria-label="${on ? "Saved" : "Save"}${item.title ? ": " + esc(item.title) : ""}">${HEART}<span class="pls-t">${on ? "Saved" : esc(opts.label || "Save")}</span></button>`; }
  function paintAll() { document.querySelectorAll(".pls-btn[data-pls-kind]").forEach((b) => { const on = isSaved(b.dataset.plsKind, b.dataset.plsRef); b.setAttribute("aria-pressed", on); const t = b.querySelector(".pls-t"); if (t && !b.classList.contains("pls-icon")) t.textContent = on ? "Saved" : "Save"; }); }

  // ---------- toasts and the board menu ----------
  let toastT = 0;
  function toast(html, { go, goLabel, ms = 6000 } = {}) { css(); document.querySelector(".pls-toast")?.remove(); const t = document.createElement("div"); t.className = "pls-toast"; t.setAttribute("role", "status");
    t.innerHTML = `<span>${html}</span>${go ? `<a class="pls-go" href="${esc(go)}">${esc(goLabel || "Open")}</a>` : ""}<button class="pls-x" type="button" aria-label="Close">×</button>`;
    t.querySelector(".pls-x").onclick = () => t.remove(); document.body.appendChild(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), ms); return t; }
  function boardMenu(btn, item) { document.querySelector(".pls-menu")?.remove(); const r = btn.getBoundingClientRect(), m = document.createElement("div"); m.className = "pls-menu"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "Add to a board");
    const cur = server?.get(key(item))?.board || "";
    m.innerHTML = `<b>Add to a board</b>${boards.map((b) => `<button type="button" data-b="${esc(b.id)}"${b.id === cur ? " aria-current=true" : ""}>${esc(b.name)}</button>`).join("")}<form><input maxlength="40" placeholder="New board, e.g. Birthday ideas" aria-label="New board name"><button>Add</button></form>`;
    document.body.appendChild(m); const w = 240, left = Math.max(8, Math.min(innerWidth - w - 8, r.left)), top = r.bottom + 8 + 200 > innerHeight ? Math.max(8, r.top - m.offsetHeight - 8) : r.bottom + 8; m.style.left = left + "px"; m.style.top = top + "px";
    const put = async (body) => { const j = await (await fetch("/api/me/saves", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...item, ...body }) })).json().catch(() => null); m.remove(); await load(true); emit(); if (j?.ok) toast(`In <b>${esc((boards.find((b) => b.id === j.saved.board) || {}).name || "your saves")}</b>.`, { go: "/saved", goLabel: "See board", ms: 3500 }); };
    m.querySelectorAll("[data-b]").forEach((b) => (b.onclick = () => put({ board: b.dataset.b })));
    m.querySelector("form").onsubmit = (e) => { e.preventDefault(); const v = m.querySelector("input").value.trim(); if (v) put({ boardName: v }); };
    setTimeout(() => { const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener("pointerdown", off, true); } }; document.addEventListener("pointerdown", off, true); }, 0);
    m.querySelector("input").focus({ preventScroll: true }); }

  // ---------- saving ----------
  async function toggle(item, btn) { const on = isSaved(item.kind, item.ref);
    if (signedIn()) { await load();
      if (server) { const r = await fetch(on ? `/api/me/saves?kind=${encodeURIComponent(item.kind)}&ref=${encodeURIComponent(item.ref)}` : "/api/me/saves", { method: on ? "DELETE" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: on ? undefined : JSON.stringify(item) });
        const j = await r.json().catch(() => null); if (!r.ok) { toast(esc(j?.message || "Couldn't save that. Try again.")); return; }
        if (on) server.delete(key(item)); else server.set(key(item), { ...item, board: "" }); emit(); setCount(item, j?.count);
        if (!on) { const t = toast(`Saved. <button type="button" class="pls-board" style="background:none;border:0;padding:0;font:inherit;font-weight:600;text-decoration:underline;cursor:pointer;color:#A63A22">Add to a board</button>`, { go: "/saved", goLabel: "Your saves", ms: 5000 }); t.querySelector(".pls-board").onclick = () => { t.remove(); boardMenu(btn || t, item); }; }
        return; } }
    // signed out: this browser keeps it, and the account gets it at signup
    let L = read(); if (on) L = L.filter((x) => !(x.kind === item.kind && x.ref === item.ref)); else L.unshift({ kind: item.kind, ref: item.ref, title: item.title || "", img: item.img || "", at: Date.now() }); write(L); emit();
    if (!on) { const n = L.length; toast(n === 1 ? `<b>Saved on this phone.</b> Make a free account to keep your saves.` : `<b>${n} saves</b> on this phone. Make a free account to keep your saves.`, { go: "/signup?mode=friends&from=saves", goLabel: "Make an account", ms: 7000 }); } }
  function setCount(item, n) { if (n == null) return; document.querySelectorAll(`[data-pls-count="${CSS_ESC(key(item))}"]`).forEach((el) => (el.textContent = countLine(n))); }
  const CSS_ESC = (s) => (window.CSS?.escape ? window.CSS.escape(s) : String(s).replace(/"/g, '\\"'));
  document.addEventListener("click", (e) => { const b = e.target.closest?.(".pls-btn[data-pls-kind]"); if (!b) return; e.preventDefault(); e.stopPropagation();
    b.classList.remove("pls-pop"); void b.offsetWidth; if (!isSaved(b.dataset.plsKind, b.dataset.plsRef)) b.classList.add("pls-pop");
    toggle({ kind: b.dataset.plsKind, ref: b.dataset.plsRef, title: b.dataset.plsTitle || "", img: b.dataset.plsImg || "" }, b); }, true);

  /** Signed in with saves from before: send them to the account, once. */
  async function merge() { const L = read(); if (!L.length || !signedIn()) return 0;
    const r = await fetch("/api/me/saves", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ merge: L }) }).catch(() => null); if (!r?.ok) return 0;
    const j = await r.json().catch(() => ({})); write([]); await load(true); emit(); const n = L.length;
    toast(`<b>Your ${n} ${n === 1 ? "save" : "saves"} came with you.</b>`, { go: "/saved", goLabel: "See them", ms: 6000 }); return j.merged || 0; }
  async function counts(keys) { if (!keys.length) return {}; const j = await (await fetch("/api/public/saves/counts?keys=" + encodeURIComponent(keys.slice(0, 100).join(",")))).json().catch(() => ({})); return j.counts || {}; }
  const ready = load().then(() => { emit(); return merge(); }).catch(() => {});
  window.PLSave = { button, isSaved, toggle, load, merge, counts, countLine, local: read, signedIn, toast, boards: () => boards, items: () => (server ? [...server.values()] : read()), on: (f) => (subs.add(f), () => subs.delete(f)), ready, css };
})();
