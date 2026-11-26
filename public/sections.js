// The host's own sections on the invite (the create canvas's "More to say? + New section"), plus the add-ons that have
// no other home on a guest page: links, parking and getting there, accessibility, co-hosts, and on the light invite the
// dress code and playlist. One file for both guest pages: the light invite (/e/:id, public/invite.html) and the full
// invite (/g, index.html, which already shows the dress code, the playlist and getting there).
// Data: the event's public fields (server/app.js PUBLIC_FIELDS: sections, links, accessNote, cohosts).
(function (root) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const P = (d) => `<path d="${d}"/>`;
  // drawn line icons (20px, stroke = currentColor): the host picks one per section
  const ICONS = {
    note: P("M5 3.5h10v13H5z") + P("M8 7.5h4M8 10.5h4M8 13.5h2"),
    star: P("m10 3 2.1 4.4 4.7.6-3.4 3.3.8 4.7L10 13.8 5.8 16l.8-4.7-3.4-3.3 4.7-.6z"),
    clock: '<circle cx="10" cy="10" r="7"/>' + P("M10 6v4l2.6 1.8"),
    pin: P("M10 17.5c-3.6-4.2-5.4-7.2-5.4-9.6a5.4 5.4 0 0 1 10.8 0c0 2.4-1.8 5.4-5.4 9.6z") + '<circle cx="10" cy="7.9" r="2"/>',
    food: P("M6 3v5a2 2 0 0 0 4 0V3M8 3v14M14 17V3c-1.7 0-3 2-3 5s1.3 3 3 3"),
    drink: P("M5 3.5h10l-5 6.5zM10 10v6.5M7 16.5h6"),
    music: P("M7.5 15V4.5l9-1.5v10.5") + '<circle cx="5.5" cy="15" r="2"/><circle cx="14.5" cy="13.5" r="2"/>',
    gift: P("M3.5 8h13v3h-13zM4.5 11h11v5.5h-11zM10 8v8.5M10 8C8.5 5 5.5 5 6 7c.3 1 2.5 1 4 1zm0 0c1.5-3 4.5-3 4-1-.3 1-2.5 1-4 1z"),
    heart: P("M10 16.5S3.5 12.6 3.5 8.2A3.3 3.3 0 0 1 10 6.6a3.3 3.3 0 0 1 6.5 1.6c0 4.4-6.5 8.3-6.5 8.3z"),
    camera: P("M3 7.5A1.5 1.5 0 0 1 4.5 6h2l1.3-2h4.4l1.3 2h2A1.5 1.5 0 0 1 17 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z") + '<circle cx="10" cy="10.8" r="2.8"/>',
    info: '<circle cx="10" cy="10" r="7"/>' + P("M10 9v4.5M10 6.5h.01"),
    key: '<circle cx="7" cy="10" r="3.2"/>' + P("M10.2 10H17M14.5 10v2.5M16.5 10v2"),
    link: P("M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.8.8M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.8-.8"),
    car: P("M4 13.5V10l1.6-4h8.8L16 10v3.5zM4 13.5V16h2.5v-2.5M13.5 13.5V16H16v-2.5M4 10h12") + '<circle cx="7" cy="11.8" r=".6"/><circle cx="13" cy="11.8" r=".6"/>',
    access: '<circle cx="10" cy="4.2" r="1.4"/>' + P("M5 7.5h10M10 7.5v4.5l-3 5M10 12l3 5"),
    shirt: P("M7 3.5 3.5 6l1.8 3 1.7-1v8.5h6V8l1.7 1 1.8-3L13 3.5c-.5 1.2-1.6 2-3 2s-2.5-.8-3-2z"),
    people: '<circle cx="7.5" cy="7" r="2.8"/>' + P("M2.5 16c.8-2.8 2.7-4.2 5-4.2s4.2 1.4 5 4.2") + '<circle cx="14" cy="7.5" r="2.2"/>' + P("M13.5 11.8c1.9 0 3.3 1.1 4 3.4"),
  };
  const PICK = ["note", "star", "clock", "pin", "food", "drink", "music", "gift", "heart", "camera", "info", "key"];
  const svg = (k) => `<svg class="evs-ic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ICONS.note}</svg>`;
  const https = (u) => (/^https:\/\/[^\s"'<>]+$/.test(String(u || "").trim()) ? String(u).trim() : "");
  const str = (v, n) => String(v ?? "").replace(/\r/g, "").trim().slice(0, n);
  /** The host's sections, cleaned: an icon from the set, a title and a body; empty ones dropped; at most 12. */
  function clean(list) { return (Array.isArray(list) ? list : []).map((s) => ({ icon: ICONS[s?.icon] ? s.icon : "note", title: str(s?.title, 80), body: str(s?.body, 1200) })).filter((s) => s.title || s.body).slice(0, 12); }
  const linksOf = (e) => (Array.isArray(e?.links) ? e.links : []).map((l) => ({ label: str(l?.label, 60), url: https(l?.url) })).filter((l) => l.url).slice(0, 6);
  const para = (t) => esc(t).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
  const block = (icon, title, inner) => `<section class="evs-b">${svg(icon)}<div><h3>${esc(title)}</h3>${inner}</div></section>`;
  /** Everything this file adds to an invite, as HTML. `full`: the full invite, which already shows dress, playlist and getting there. */
  function html(e, { full = false } = {}) { if (!e) return ""; const out = [];
    const co = (Array.isArray(e.cohosts) ? e.cohosts : []).map((c) => str(c?.name || (c?.handle ? "@" + String(c.handle).replace(/^@/, "") : ""), 60)).filter(Boolean);
    if (co.length) out.push(`<p class="evs-co">${svg("people")}<span>With ${esc(co.length > 1 ? co.slice(0, -1).join(", ") + " and " + co[co.length - 1] : co[0])}</span></p>`);
    if (!full) { if (str(e.dress, 80)) out.push(block("shirt", "Dress code", `<p>${esc(str(e.dress, 80))}</p>`));
      if (https(e.playlistUrl)) out.push(block("music", "Playlist", `<p><a href="${esc(https(e.playlistUrl))}" target="_blank" rel="noopener nofollow">Open the playlist</a></p>`));
      const gt = (Array.isArray(e.getThere) ? e.getThere : []).map((s) => str(s?.x, 200)).filter(Boolean); if (gt.length) out.push(block("car", "Parking and getting there", gt.map((x) => `<p>${esc(x)}</p>`).join(""))); }
    const L = linksOf(e); if (L.length) out.push(block("link", L.length > 1 ? "Links" : L[0].label || "Link", L.map((l) => `<p><a href="${esc(l.url)}" target="_blank" rel="noopener nofollow">${esc(l.label || l.url.replace(/^https:\/\//, "").replace(/\/$/, ""))}</a></p>`).join("")));
    if (str(e.accessNote, 300)) out.push(block("access", "Accessibility", `<p>${para(str(e.accessNote, 300))}</p>`));
    for (const s of clean(e.sections)) out.push(block(s.icon, s.title || "A note from the host", s.body ? `<p>${para(s.body)}</p>` : ""));
    return out.length ? `<div class="evs" id="evSections">${out.join("")}</div>` : ""; }
  const CSS = `.evs{display:grid;gap:4px;margin:16px 0 8px}.evs-b{display:grid;grid-template-columns:22px minmax(0,1fr);gap:12px;align-items:start;padding:14px 0;border-top:1px solid color-mix(in srgb,currentColor 14%,transparent)}
.evs-b:first-child{border-top:0}.evs-ic{width:20px;height:20px;margin-top:2px;opacity:.8}.evs .evs-b h3{margin:0 0 4px;font:600 17px/1.3 var(--sys-title,"IBM Plex Sans"),system-ui,sans-serif!important;letter-spacing:-.005em}
.evs-b p{margin:0 0 6px;font-size:16px;line-height:1.55;overflow-wrap:anywhere}.evs-b p:last-child{margin-bottom:0}.evs-b a{color:inherit;text-decoration:underline;text-underline-offset:3px}
.evs-co{display:flex;gap:10px;align-items:center;margin:0 0 4px;font-weight:500}.evs-co .evs-ic{margin:0}`;
  root.EventSections = { ICONS, PICK, svg, clean, html, linksOf };
  if (typeof document === "undefined") return;
  const css = () => { if (document.getElementById("evsCss")) return; const s = document.createElement("style"); s.id = "evsCss"; s.textContent = CSS; document.head.appendChild(s); };
  const light = /^\/[ei]\/[A-Za-z0-9_-]{2,80}$/.test(location.pathname), id = light ? location.pathname.split("/")[2] : "";
  let ev = null, asked = false, t = 0;
  const put = (at, h, where) => { const old = document.getElementById("evSections"), sig = h.length + ":" + where + ":" + [...h].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0); if (old && old.dataset.sig === sig && old.previousElementSibling === at) return; old?.remove(); if (!h || !at) return; css(); at.insertAdjacentHTML(where, h); const n = document.getElementById("evSections"); if (n) n.dataset.sig = sig; };
  const run = () => {
    if (light) { const m = document.getElementById("m"); if (!m || !m.querySelector("h1")) return;
      if (id === "_preview") ev = root.__pvEv || null; // the create canvas's live preview (public/invite-preview.js)
      if (!ev) { if (!asked && id !== "_preview") { asked = true; fetch("/api/db/doc?path=" + encodeURIComponent("events/" + id), { headers: { "x-encore-guest": "1" } }).then((r) => (r.ok ? r.json() : null)).then((j) => { ev = j?.data || j || {}; run(); }).catch(() => {}); } return; }
      const kits = m.querySelectorAll(":scope > .kit"), at = kits[kits.length - 1] || m.querySelector(":scope > .why") || m.querySelector(":scope > .host") || m.querySelector(":scope > .facts");
      return put(at, html(ev), "afterend"); }
    if (location.pathname === "/g" && /^#rsvp-/.test(location.hash)) { const e = root.__gEv, inn = document.querySelector("#view-guest .in"); if (!e || !inn) return;
      const at = inn.querySelector(":scope > .ev2-extras") || inn.querySelector(":scope > .gk") || inn.querySelector(":scope > .gxfacts"); return put(at, html(e, { full: true }), "afterend"); } };
  if (light || location.pathname === "/g") new MutationObserver(() => { clearTimeout(t); t = setTimeout(run, 150); }).observe(document.documentElement, { childList: true, subtree: true });
})(typeof window !== "undefined" ? window : globalThis);
