// List cards in the feed (server/listfeed.js): "Maya made a list" with the list's name, how many things and the first
// covers, or "Maya added Dumpling Night and Sunday Pasta to Weekend ideas". Follow list and Save for a public list
// (public/listpublic.js does the tap, in place with Undo), Open list for a friends list, then the feed's own kudos,
// comment and share row (FeedVisual.actRow), so kudos and comments work like on any card.
// Loaded after public/feedvisual.js; it adds one renderer, FeedVisual.RENDER.list, and leaves every other card alone.
(function () {
  const FV = window.FeedVisual; if (!FV || FV.RENDER.list) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const safeUrl = (u) => (/^\/[A-Za-z0-9@_\-./#?=&%]*$/.test(u || "") && !/^\/\//.test(u) ? u : "");
  const safeImg = (u) => (/^\/_blob\/[A-Za-z0-9]{6,40}$/.test(u || "") || /^\/presets\/[A-Za-z0-9_.-]{1,80}$/.test(u || "") ? u : "");
  const okColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "#F3E7A8");
  const CSS = `.pll-fc .pll-fc-by{display:flex;align-items:center;gap:10px;min-height:44px;margin:0 0 10px;text-decoration:none;color:inherit}
.pll-fc .pll-face{flex:none;width:36px;height:36px;border-radius:50%;border:1.5px solid var(--pl-ink,#1B1D1C);display:grid;place-items:center;background:var(--c);font:600 15px var(--pl-font-text,"IBM Plex Sans"),system-ui;color:var(--pl-ink,#1B1D1C)}
.pll-fc .pll-fc-by span{min-width:0}.pll-fc .pll-fc-by b{font-weight:600}.pll-fc .pll-fc-by small{display:block;color:var(--pl-soft,#444845);font-size:14px}
.pll-fc .pll-fc-t{margin:4px 0 4px}.pll-fc .pll-fc-t a{text-decoration:none;color:inherit}.pll-fc .pll-fc-n{color:var(--pl-soft,#444845);font-size:15px;margin:0 0 12px}
.pll-fc .pll-fc-line{margin:0 0 4px;font-size:16px;line-height:1.45}
.pll-fc .pll-fc-cv{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 0 12px;padding:0;list-style:none}
.pll-fc .pll-fc-cv a{display:block;text-decoration:none;color:inherit;min-width:0}.pll-fc .pll-fc-cv i{position:relative;display:block;aspect-ratio:1;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;overflow:hidden;background:var(--pl-raised,#E6E1D5)}
.pll-fc .pll-fc-cv img,.pll-fc .pll-fc-cv svg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.pll-fc .pll-fc-cv .ea-cover .ea-txt{display:none}
.pll-fc .pll-fc-cv small{display:block;margin-top:4px;font-size:13px;line-height:1.3;color:var(--pl-soft,#444845);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pll-fc .pll-fc-go{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 4px}
.pll-fc .pll-go{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 14px;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:600 14px var(--pl-font-text,"IBM Plex Sans"),system-ui;text-decoration:none;cursor:pointer;white-space:nowrap}
.pll-fc .pll-go.primary{background:var(--pl-accent,#29489A);border-color:var(--pl-accent,#29489A);color:var(--pl-on-accent,#fff)}.pll-fc .pll-go[aria-pressed=true]{background:var(--pl-ink,#1B1D1C);border-color:var(--pl-ink,#1B1D1C);color:var(--pl-page,#EFEBE2)}
.pll-fc .pll-go:focus-visible,.pll-fc a:focus-visible{outline:3px solid var(--pl-focus,rgba(41,72,154,.3));outline-offset:2px}`;
  const css = () => { if (document.getElementById("pllFcCss")) return; const s = document.createElement("style"); s.id = "pllFcCss"; s.textContent = CSS; document.head.appendChild(s); };
  // the tap itself lives in public/listpublic.js; load it the first time a list card is drawn
  const need = () => { if (window.PLLists || document.querySelector('script[src="/listpublic.js"]')) return; const s = document.createElement("script"); s.src = "/listpublic.js"; s.async = true; document.head.appendChild(s); };
  const pic = (i) => { const im = safeImg(i.img); if (im) return `<img src="${esc(im)}" alt="" loading="lazy" decoding="async">`; const A = window.EventArt; if (A?.cover && i.kind === "event") { try { return A.cover({ id: i.ref, title: i.title || "", activity: i.art?.activity || "" }); } catch {} } return ""; };
  const WORD = { "Follow list": "Following", Save: "Saved" };
  const go = (act, key, on, label, name, cls = "") => `<button type="button" class="pll-go ${cls}" data-pll-act="${act}" data-key="${esc(key)}" data-name="${esc(name)}" aria-pressed="${!!on}">${esc(on ? WORD[label] : label)}</button>`;
  function listCard(it) { css(); need(); const L = it.list || {}, by = it.by || {}, url = safeUrl(L.url) || "#", made = it.type === "made";
    const who = `<span class="pll-face" style="--c:${esc(okColor(by.color))}" aria-hidden="true">${esc(String(by.name || "?").slice(0, 1).toUpperCase())}</span><span><b>${esc(by.name || "Someone")}</b><small>${made ? "Made a list" : "Added to a list"} · ${L.mode === "public" ? "Public" : "Friends"}</small></span>`;
    return `<article class="fb-card pll-fc" data-kind="list">
      ${safeUrl(by.url) ? `<a class="pll-fc-by" href="${esc(by.url)}">${who}</a>` : `<p class="pll-fc-by">${who}</p>`}
      ${made ? "" : `<p class="pll-fc-line">${esc(it.text)}</p>`}
      <h3 class="fb-title pll-fc-t"><a href="${esc(url)}">${esc(L.name)}</a></h3><p class="pll-fc-n">${esc(`${L.count} thing${L.count === 1 ? "" : "s"}`)}</p>
      <ul class="pll-fc-cv" aria-label="On ${esc(L.name)}">${(it.items || []).slice(0, 4).map((i) => `<li><a href="${esc(safeUrl(i.url) || url)}"><i aria-hidden="true">${pic(i)}</i><small>${esc(i.title)}</small></a></li>`).join("")}</ul>
      <div class="pll-fc-go">${L.canFollow ? go("list", L.token, L.following, "Follow list", L.name, "primary") + go("save", L.token, L.saved, "Save", L.name) : `<a class="pll-go primary" href="${esc(url)}">Open list</a>`}</div>
      ${FV.actRow ? FV.actRow(it) : ""}</article>`; }
  FV.RENDER.list = listCard;
})();
