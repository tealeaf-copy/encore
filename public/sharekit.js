// The share sheet: one calm sheet for a host's "Share invite" (and the moment it goes live) and a guest's "Invite friends".
// Preview first, then the ways to send it. Three formats you swipe between (or arrow keys, or the dots), each with its
// own row of actions:
//   1. Link card: the card people see in Messages and WhatsApp (the same picture /e/<id> gives as its og:image).
//   2. Flyer: a 1080x1920 image for a story or a group chat, drawn here with canvas: the date big, the cover, the title.
//   3. QR code: the invite's link as a code (public/qr.js, high error correction), with Potto's line mark in the middle.
// Colours and faces come from the host's brand kit (--kit-*, public/brandkit.js) when the page has one, else the brand
// tokens (--pl-*, public/system.css), so a rebrand lands on the pictures too. The wordmark is always ours.
//
// The API, for any page (the event page, Find people, the create canvas). Load /sharekit.js, then:
//
//   const S = await ShareKit.open({
//     event,       // an event object (name or pubTitle, date, startTime, hood or city, coverPhoto, coverArt, hostName)
//     eventId,     // or just its id: the public copy is read for you
//     url,         // the link to send. Default: <origin>/e/<eventId>. A url alone (no event) works too
//     title, when, where, cover, host,   // optional: override what the event says
//     text,        // the message sent with the link. Default: "<title>, <when> at <where>. Are you in? <url>"
//     kind,        // "guest" for a guest's Invite friends; anything else is a host sharing their own invite
//     hold,        // one line at the top, e.g. "We'll hold a spot for a friend for 48 hours."
//     start,       // "link" (default), "flyer" or "qr": the format it opens on
//     brand,       // optional colours and face: { page, ink, soft, accent, line, display }
//     track,       // (what) => {}: "copy", "sms", "instagram", "whatsapp", "more", "save", "story"
//     onCard,      // (blob, data) => {}: the 1200x630 link card once drawn (the host page saves it as the og:image)
//     onClose,     // () => {}
//   });
//   S.close(); S.el;   // the open sheet
//
// ShareKit.linkCard / flyer / qrCard (data) draw the pictures on their own (each returns a canvas), and ShareKit.norm
// turns open()'s options into that data. window.PLShare is the same object, for older callers.
(function () {
  if (window.ShareKit) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const tok = (n, fb) => { try { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || fb; } catch { return fb; } };
  const fam = (f) => (!f ? "" : /[,"']/.test(f) ? f : `"${f}"`);
  // the picture's palette: the host's kit first, then our tokens
  const T = (b = {}) => { const kd = tok("--kit-display", ""), house = tok("--pl-font-display", '"IBM Plex Serif", Georgia, serif');
    return { page: b.page || tok("--kit-page", "") || tok("--pl-page", "#F4F0E8"), card: tok("--kit-surface", "") || tok("--pl-surface", "#FBF9F5"), raised: tok("--pl-raised", "#ECE6DB"),
      ink: b.ink || tok("--kit-ink", "") || tok("--pl-ink", "#1D1B18"), soft: b.soft || tok("--kit-soft", "") || tok("--pl-soft", "#5D564E"), line: b.line || tok("--kit-line", "") || tok("--pl-line", "#E2DCD1"),
      accent: b.accent || tok("--kit-accent-text", "") || tok("--pl-accent-text", "#8E3B24"),
      display: b.display ? `${fam(b.display)}, ${house}` : kd ? `${fam(kd)}, ${house}` : house, dw: b.display ? "400" : kd ? tok("--kit-dw", "400") : "400",
      house, sans: tok("--kit-body", "") ? `${fam(tok("--kit-body", ""))}, system-ui, sans-serif` : tok("--pl-font-text", '"IBM Plex Sans", system-ui, sans-serif'), mono: tok("--pl-font-mono", "ui-monospace, monospace"), mark: tok("--pl-ink", "#1D1B18") }; };
  const loadScript = (src, ready) => new Promise((ok) => { if (ready()) return ok(); const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = ok; document.head.appendChild(s); });
  // drawn glyphs (1.75 stroke, currentColor): no third-party logos
  const G = (d, w = 24) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = { link: G('<path d="M10 14a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1-1"/>'),
    chat: G('<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17h0A1.5 1.5 0 0 1 4 15.5z"/><path d="M8.5 9.5h7M8.5 12.5h4.5"/>'),
    sms: G('<path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10l-4 3.5v-3.5h0a1.5 1.5 0 0 1-1.5-1.5z"/>'), wa: G('<path d="M5.2 19.2l1-3.4a7.6 7.6 0 1 1 2.6 2.5z"/><path d="M9.3 9.2c.3 2.2 2.3 4.2 4.6 4.6l1-1.1-1.6-.8-.6.6c-.9-.4-1.6-1.1-2-2l.6-.6-.8-1.6z"/>'),
    ig: G('<rect x="4.5" y="4.5" width="15" height="15" rx="4.5"/><circle cx="12" cy="12" r="3.4"/><path d="M16.6 7.4h.01"/>'), story: G('<circle cx="12" cy="12" r="7.5" stroke-dasharray="3.2 2.4"/><path d="M12 9v6M9 12h6"/>'),
    more: G('<path d="M12 4.5v10M8 8l4-3.5L16 8M5.5 12.5v6h13v-6"/>'), save: G('<path d="M12 4.5v10M8 11l4 3.5 4-3.5M5.5 18.5h13"/>'), x: G('<path d="M6 6l12 12M18 6L6 18"/>', 22), prev: G('<path d="M14.5 6 8.5 12l6 6"/>', 20), next: G('<path d="m9.5 6 6 6-6 6"/>', 20) };
  // Potto's line mark (public/favicon.svg): the pot's rim and body in one stroke, two dots and a small smile
  const MARK = "M17 11h14M19 11v4l-6 6v9a7 7 0 0 0 7 7h8a7 7 0 0 0 7-7v-9l-6-6v-4"; // the Field Notes Potto (public/favicon.svg), drawn in a 48 box
  function lineMark(g, x, y, s, color) { g.save(); g.translate(x, y); g.scale(s / 48, s / 48); g.strokeStyle = g.fillStyle = color; g.lineCap = g.lineJoin = "round";
    g.lineWidth = 2.75; g.stroke(new Path2D(MARK)); for (const cx of [20.5, 27.5]) { g.beginPath(); g.arc(cx, 26, 1.9, 0, Math.PI * 2); g.fill(); } g.restore(); }
  // the wordmark: the line mark and "pottery lab" in the house serif, ink. It is chrome, so a host's kit never restyles it
  function wordmark(g, x, y, size, t) { lineMark(g, x, y - size * 0.92, size * 1.05, t.mark); g.fillStyle = t.mark; g.font = `400 ${size}px ${t.house}`; g.textBaseline = "alphabetic"; g.fillText("pottery lab", x + size * 1.32, y); }

  // ---- event data, from what the page passed or the public event ----
  const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateOf = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); if (!m) return null; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return { dow: DOW[d.getUTCDay()], md: `${MON[d.getUTCMonth()]} ${d.getUTCDate()}` }; };
  const clock = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); if (!m) return ""; const h = +m[1], mm = m[2]; return `${h % 12 || 12}${mm === "00" ? "" : ":" + mm}${h < 12 ? "am" : "pm"}`; };
  const safeImg = (u) => (/^\/_blob\/[A-Za-z0-9_-]{6,80}$/.test(u || "") || /^https:\/\/[^\s"'<>()]+$/.test(u || "") ? u : "");
  // the public event and its host's first name ("Nadia is hosting"), when the page passed only an id
  async function fill(o) { const id = o.eventId || o.event?.id; if (!id) return o; const J = (u, h) => fetch(u, { headers: h }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [ev, h] = await Promise.all([o.event ? null : J("/api/db/doc?path=" + encodeURIComponent("events/" + id), { "x-encore-guest": "1" }), o.host || o.event?.hostName ? null : J("/api/public/event-host/" + encodeURIComponent(id))]);
    if (ev?.data) o.event = ev.data; if (!o.host && typeof h?.person === "string") o.host = h.person.slice(0, 40); return o; }
  function norm(o = {}) { const e = o.event || {}, d = dateOf(e.date), time = o.time || clock(e.startTime), day = o.day || (d ? `${d.dow.slice(0, 3)}, ${d.md}` : "");
    const url = o.url || (o.eventId || e.id ? `${location.origin}/e/${o.eventId || e.id}` : location.href);
    return { ...o, url, title: o.title || e.pubTitle || e.name || "You're invited", day, dow: o.dow || d?.dow || "", md: o.md || d?.md || "", time, when: o.when || [day, time].filter(Boolean).join(" · "),
      where: o.where || e.hood || e.city || e.meetPoint || "", host: o.host || e.hostName || "", cover: safeImg(o.cover || e.coverPhoto || ""),
      domain: (() => { try { return new URL(url, location.href).host; } catch { return location.host; } })() }; }

  // ---- the pictures ----
  const loadImg = (src) => new Promise((ok) => { if (!src) return ok(null); const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
  async function artImage(e) { const A = window.EventArt; if (!A) return null; try { const pick = e?.coverArt && typeof e.coverArt === "object" ? e.coverArt : {}, k = A.valid?.(pick.kind) ? pick.kind : A.kindOf(e || {}), tone = A.PASTELS?.[pick.tone] ? pick.tone : A.toneOf(e || {}, k);
    const cs = e?.coverSpec?.art, LT = cs && /^#[0-9a-f]{6}$/i.test(cs.bg || "") ? cs : A.lookTone?.(e) /* the event's look colours the share card too, like the invite and the feed */;
    const svg = A.drawing(k, LT?.spot || A.SPOT[tone]), img = await loadImg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)); return img ? { img, bg: LT?.bg || A.PASTELS[tone] } : null; } catch { return null; } }
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
  function coverDraw(g, x, y, w, h, r, pic, art, t) { g.save(); rr(g, x, y, w, h, r); g.clip();
    if (pic) { const s = Math.max(w / pic.width, h / pic.height), iw = pic.width * s, ih = pic.height * s; g.drawImage(pic, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); }
    else { g.fillStyle = art?.bg || t.raised; g.fillRect(x, y, w, h); if (art?.img) { const aw = Math.min(w * 0.72, h * 0.96), ah = aw * 0.75; g.drawImage(art.img, x + (w - aw) / 2, y + (h - ah) / 2, aw, ah); } else lineMark(g, x + w / 2 - h * 0.16, y + h * 0.34, h * 0.32, t.soft); }
    g.restore(); }
  // even lines: the narrowest width that keeps the same number of lines, so a title never leaves one word alone
  function balance(g, text, maxW, n) { let lo = maxW * 0.5, hi = maxW; for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (wrap(g, text, mid, 99).length > n) lo = mid; else hi = mid; } return wrap(g, text, hi, n); }
  function wrap(g, text, maxW, maxLines) { const words = String(text).split(/\s+/), lines = []; let cur = "";
    for (const w of words) { const t = cur ? cur + " " + w : w; if (g.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
    if (cur) lines.push(cur); if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); let last = keep[maxLines - 1]; while (last && g.measureText(last + "…").width > maxW) last = last.slice(0, -1); keep[maxLines - 1] = last.trimEnd() + "…"; return keep; } return lines; }
  // the biggest size (down to min) at which text fits maxW in maxLines
  function fit(g, text, font, max, min, maxW, maxLines) { for (let s = max; s >= min; s -= 4) { g.font = font(s); const L = wrap(g, text, maxW, 99); if (L.length <= maxLines) return { s, L: L.length > 1 ? balance(g, text, maxW, L.length) : L }; } g.font = font(min); return { s: min, L: wrap(g, text, maxW, maxLines) }; }
  async function fonts(t) { try { await Promise.all([`${t.dw} 80px ${t.display}`, `400 80px ${t.house}`, `500 40px ${t.sans}`, `500 32px ${t.mono}`].map((f) => document.fonts?.load(f))); } catch {} }
  const kicker = (D) => (D.host ? `${D.host} is hosting` : "You're invited");
  /** The link card (1200x630): the picture Messages and WhatsApp show above the link. */
  async function linkCard(D, pic, art) { const t = T(D.brand); await fonts(t); const c = document.createElement("canvas"); c.width = 1200; c.height = 630; const g = c.getContext("2d");
    g.fillStyle = t.page; g.fillRect(0, 0, 1200, 630); coverDraw(g, 0, 0, 600, 630, 0, pic, art, t);
    const X = 656, W = 488; g.fillStyle = t.ink; const F = fit(g, D.title, (s) => `${t.dw} ${s}px ${t.display}`, 76, 52, W, 3);
    // the words sit in the middle of the space above the wordmark
    const top = 76 + Math.max(0, (440 - (28 + 24 + F.s * 1.05 * F.L.length + 18 + (D.when ? 46 : 0) + (D.where ? 30 : 0))) / 2);
    g.fillStyle = t.soft; g.font = `500 28px ${t.mono}`; g.fillText(kicker(D).toUpperCase().slice(0, 28), X, top + 28);
    g.fillStyle = t.ink; g.font = `${t.dw} ${F.s}px ${t.display}`; F.L.forEach((l, i) => g.fillText(l, X, top + 28 + 24 + F.s * 1.05 * (i + 1) - F.s * 0.2));
    let y = top + 28 + 24 + F.s * 1.05 * F.L.length + 46; g.font = `500 32px ${t.sans}`; if (D.when) { g.fillStyle = t.accent; g.fillText(D.when, X, y); y += 46; } g.fillStyle = t.soft; g.font = `400 30px ${t.sans}`; if (D.where) wrap(g, D.where, W, 1).forEach((l) => g.fillText(l, X, y));
    wordmark(g, X, 566, 30, t); return c; }
  /** The flyer (1080x1920): the date big, the cover inset, the title, and the mark. */
  async function flyer(D, pic, art) { const t = T(D.brand); await fonts(t); const c = document.createElement("canvas"); c.width = 1080; c.height = 1920; const g = c.getContext("2d");
    g.fillStyle = t.page; g.fillRect(0, 0, 1080, 1920); const X = 96, W = 888; g.textBaseline = "alphabetic";
    g.fillStyle = t.soft; g.font = `500 34px ${t.mono}`; g.fillText(kicker(D).toUpperCase().slice(0, 34), X, 168);
    // the date, in big type
    g.fillStyle = t.ink; if (D.md) { const F = fit(g, D.md, (s) => `${t.dw} ${s}px ${t.display}`, 260, 160, W, 1); g.fillText(F.L[0], X - 6, 168 + 40 + F.s * 0.78); }
    else { g.font = `${t.dw} 200px ${t.display}`; g.fillText("Soon", X - 6, 168 + 40 + 156); }
    g.fillStyle = t.accent; g.font = `500 52px ${t.sans}`; g.fillText([D.dow, D.time].filter(Boolean).join(" · ") || "Date to come", X, 520);
    const cy = 590, ch = 760; coverDraw(g, X, cy, W, ch, 36, pic, art, t); g.strokeStyle = t.line; g.lineWidth = 2; rr(g, X + 1, cy + 1, W - 2, ch - 2, 35); g.stroke();
    g.fillStyle = t.ink; const F = fit(g, D.title, (s) => `${t.dw} ${s}px ${t.display}`, 104, 72, W, 2); F.L.forEach((l, i) => g.fillText(l, X, cy + ch + 40 + F.s * 0.9 + i * F.s * 1.04));
    const y = cy + ch + 40 + F.s * 0.9 + (F.L.length - 1) * F.s * 1.04 + 72; if (D.where) { g.fillStyle = t.soft; g.font = `400 44px ${t.sans}`; wrap(g, D.where, W, 1).forEach((l) => g.fillText(l, X, y)); }
    g.strokeStyle = t.line; g.lineWidth = 2; g.beginPath(); g.moveTo(X, 1712); g.lineTo(X + W, 1712); g.stroke();
    wordmark(g, X, 1800, 42, t); g.fillStyle = t.soft; g.font = `500 28px ${t.mono}`; const rp = D.domain.slice(0, 30); g.fillText(rp, X + W - g.measureText(rp).width, 1796); return c; }
  /** The QR card (1080x1080): a plain, high-contrast code (error correction H) with Potto's line mark in a clear circle. */
  async function qrCard(D) { await loadScript("/qr.js", () => window.PLQR); const t = T(D.brand); await fonts(t); if (!window.PLQR) return null;
    const { canvas: q, qr } = window.PLQR.toCanvas(D.url, { ecl: "H", px: 20, margin: 4, dark: t.mark, light: "#FFFFFF" }); const c = document.createElement("canvas"); c.width = c.height = 1080; const g = c.getContext("2d");
    g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, 1080, 1080); const s = 960, o = 60; g.imageSmoothingEnabled = false; g.drawImage(q, o, o, s, s);
    // the centre circle covers about 7% of the code, well inside what level H restores (30%)
    const cx = 540, r = Math.round(s * (4.6 / (qr.size + 8))); g.fillStyle = "#FFFFFF"; g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.fill(); lineMark(g, cx - r * 0.66, cx - r * 0.7, r * 1.32, t.mark); return c; }
  const toBlob = (c, type = "image/png", q) => new Promise((ok) => c.toBlob((b) => ok(b), type, q));

  // ---- the sheet ----
  let CSS_ON = false;
  function css() { if (CSS_ON) return; CSS_ON = true; const s = document.createElement("style"); s.id = "plshCss"; s.textContent = `
.plsh-bg{position:fixed;inset:0;z-index:2147482000;background:rgba(29,27,24,.38);display:flex;align-items:flex-end;justify-content:center;animation:plshF .18s ease-out}
.plsh{position:relative;width:min(480px,100%);max-height:94vh;max-height:94dvh;overflow-y:auto;display:flex;flex-direction:column;background:var(--pl-surface,#FBF9F5);color:var(--pl-ink,#1D1B18);border-radius:20px 20px 0 0;box-shadow:var(--pl-shadow-float,0 12px 32px -16px rgba(29,27,24,.28));font-family:var(--pl-font-text,system-ui);padding:6px 0 calc(14px + env(safe-area-inset-bottom,0px));box-sizing:border-box;animation:plshU .26s cubic-bezier(.2,.8,.2,1)}
@media (min-width:700px){.plsh-bg{align-items:center}.plsh{border-radius:20px;padding-bottom:18px}}
.plsh-grab{width:36px;height:4px;border-radius:2px;background:var(--pl-line-strong,#CFC6B8);margin:4px auto 2px}@media (min-width:700px){.plsh-grab{display:none}}
.plsh-hd{display:flex;align-items:flex-start;gap:8px;padding:6px 8px 0 24px}.plsh-hd div{flex:1;min-width:0;padding-top:8px}.plsh-hd h2:focus{outline:none}
.plsh .plsh-hd h2{margin:0!important;font:600 28px/1.1 var(--pl-font-display,"IBM Plex Sans")!important;letter-spacing:-.015em;color:inherit}.plsh-hd p{margin:6px 0 0;color:var(--pl-soft,#5D564E);font-size:15px;line-height:1.4;min-height:21px}
.plsh-x{flex:none;width:44px;height:44px;border-radius:50%;border:0;background:none;color:var(--pl-soft,#5D564E);display:grid;place-items:center;cursor:pointer}.plsh-x:hover{background:var(--pl-raised,#ECE6DB)}
.plsh-hold{margin:12px 24px 0;padding:10px 14px;border-radius:12px;background:var(--pl-sand-soft,#F0E9DA);color:var(--pl-ink,#1D1B18);font-size:14px;line-height:1.35}
.plsh-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;outline:none;flex:none;margin-top:8px}.plsh-track::-webkit-scrollbar{display:none}
.plsh-track:focus-visible{box-shadow:inset 0 0 0 2px var(--pl-focus,rgba(154,65,40,.28))}
.plsh-slide{flex:0 0 100%;scroll-snap-align:center;scroll-snap-stop:always;box-sizing:border-box;padding:12px 24px 0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;}
.plsh-pv{display:block;border:0;padding:0;background:none;cursor:pointer;color:inherit;font:inherit;text-align:left;border-radius:16px;transition:transform .15s}.plsh-pv:active{transform:scale(.98)}
.plsh-card{width:min(100%,320px);border:1px solid var(--pl-line,#E2DCD1);border-radius:16px;overflow:hidden;background:var(--pl-raised,#ECE6DB)}.plsh-card img{display:block;width:100%;aspect-ratio:1200/630;object-fit:cover;background:var(--pl-raised,#ECE6DB)}
.plsh-card b{display:block;padding:10px 14px 0;font-size:16px;font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.plsh-card small{display:block;padding:2px 14px 12px;color:var(--pl-soft,#5D564E);font-size:13px}
.plsh-fly{height:min(40vh,350px);aspect-ratio:9/16;display:block;border-radius:14px;border:1px solid var(--pl-line,#E2DCD1);background:var(--pl-page,#F4F0E8);box-shadow:var(--pl-shadow-float)}
.plsh-qr{width:min(64vw,252px);aspect-ratio:1;display:block;border-radius:16px;border:1px solid var(--pl-line,#E2DCD1);background:#fff}
.plsh-dc{border:0;background:none;color:var(--pl-soft,#5D564E);font:500 13px var(--pl-font-text,system-ui);text-decoration:underline;text-underline-offset:3px;min-height:36px;cursor:pointer;margin-top:-6px}
.plsh-tap{margin:0;color:var(--pl-muted,#6E665D);font-size:13px;text-align:center;min-height:18px}
.plsh-dots{display:flex;justify-content:center;align-items:center;margin:6px 0 0}.plsh-dots button{width:44px;height:44px;margin:-8px;border:0;background:none;display:grid;place-items:center;cursor:pointer;padding:0}.plsh-dots button::after{content:"";width:6px;height:6px;border-radius:3px;background:var(--pl-line-strong,#CFC6B8);transition:width .2s,background .2s}.plsh-dots button[aria-current="true"]::after{width:18px;background:var(--pl-ink,#1D1B18)}
.plsh-nav{position:absolute;top:46%;width:40px;height:40px;border-radius:50%;border:1px solid var(--pl-line,#E2DCD1);background:var(--pl-surface,#FBF9F5);color:var(--pl-ink,#1D1B18);display:none;place-items:center;cursor:pointer}@media (hover:hover) and (min-width:700px){.plsh-nav{display:grid}}.plsh-nav[disabled]{opacity:0;pointer-events:none}.plsh-nav.p{left:10px}.plsh-nav.n{right:10px}
.plsh-row{display:flex;justify-content:center;gap:4px;padding:14px 8px 0}.plsh-row:has(.plsh-t:nth-child(6)){gap:1px;padding-left:2px;padding-right:2px}
.plsh-t{flex:0 1 68px;min-width:0;display:grid;justify-items:center;gap:6px;border:0;background:none;color:var(--pl-ink,#1D1B18);font:500 13px/1.2 var(--pl-font-text,system-ui);cursor:pointer;padding:4px 0;text-align:center}
.plsh-t i{width:54px;height:54px;border-radius:50%;display:grid;place-items:center;background:var(--pl-raised,#ECE6DB);color:var(--pl-ink,#1D1B18);font-style:normal;transition:background .15s}.plsh-t:hover i{background:var(--pl-line,#E2DCD1)}.plsh-t.pri i{background:var(--pl-ink,#1D1B18);color:#fff}
.plsh-t:focus-visible{outline:none}.plsh-t:focus-visible i{outline:2px solid var(--pl-ink,#1D1B18);outline-offset:2px}
.plsh-tap.on{color:var(--pl-success,#3D6A4C);font-weight:600}.plsh-tap.on::before{content:"";display:inline-block;width:10px;height:5px;border:solid currentColor;border-width:0 0 2px 2px;transform:translateY(-3px) rotate(-45deg);margin-right:8px}
.plsh-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);margin:0}
@keyframes plshF{from{opacity:0}}@keyframes plshU{from{transform:translateY(24px);opacity:0}}
@media (prefers-reduced-motion:reduce){.plsh-bg,.plsh{animation:none}.plsh-pv,.plsh-dots button::after{transition:none}}`; document.head.appendChild(s); }

  async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch { const a = document.createElement("textarea"); a.value = t; a.style.position = "fixed"; a.style.opacity = "0"; document.body.appendChild(a); a.select(); let ok = false; try { ok = document.execCommand("copy"); } catch {} a.remove(); return ok; } }
  async function copyImage(blob) { try { if (!window.ClipboardItem) return false; await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); return true; } catch { return false; } }
  function download(blob, name) { const u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); }
  async function shareFile(blob, name, extra = {}) { try { const f = new File([blob], name, { type: blob.type }); if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], ...extra }); return true; } } catch (e) { if (e?.name === "AbortError") return true; } return false; }
  const phone = () => matchMedia("(pointer:coarse)").matches;

  async function open(opts = {}) { const prev0 = document.activeElement; css(); await fill(opts); const D = norm(opts), prev = prev0 && prev0 !== document.body && prev0.isConnected ? prev0 : document.activeElement;
    const name = (D.title || "invite").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "invite";
    const msg = opts.text || `${D.title}${D.when ? `, ${D.when}` : ""}${D.where ? ` at ${D.where}` : ""}. Are you in? ${D.url}`;
    const S = [
      { k: "link", h: "Sending to someone?", p: opts.kind === "guest" ? "This is the card your friend sees." : "This is the card people see in their chats.", label: "Link card" },
      { k: "flyer", h: "Share flyer", p: "Post to socials or send with the link.", label: "Flyer" },
      { k: "qr", h: "Scan to reply", p: "Point a phone camera at it to open the invite.", label: "QR code" } ];
    document.getElementById("plShare")?.remove(); const bg = document.createElement("div"); bg.className = "plsh-bg"; bg.id = "plShare";
    bg.innerHTML = `<div class="plsh" role="dialog" aria-modal="true" aria-labelledby="plshH"><div class="plsh-grab" aria-hidden="true"></div>
      <div class="plsh-hd"><div><h2 id="plshH" tabindex="-1">${esc(S[0].h)}</h2><p id="plshP">${esc(S[0].p)}</p></div><button type="button" class="plsh-x" aria-label="Close">${IC.x}</button></div>
      ${opts.hold ? `<p class="plsh-hold">${esc(opts.hold)}</p>` : ""}
      <div class="plsh-track" tabindex="0" role="region" aria-roledescription="carousel" aria-label="Ways to share. Swipe or use the arrow keys.">
        <section class="plsh-slide" aria-roledescription="slide" aria-label="1 of 3: Link card"><button type="button" class="plsh-pv plsh-card" data-tap="link" aria-label="Copy the link"><img alt="" data-img="card"><b>${esc(D.title)}</b><small>${esc(D.domain)}</small></button><p class="plsh-tap">Tap to copy</p>${opts.kind === "guest" ? "" : `<button type="button" class="plsh-dc" data-dc>Copy for Discord or Slack</button>`}</section>
        <section class="plsh-slide" aria-roledescription="slide" aria-label="2 of 3: Flyer"><button type="button" class="plsh-pv" data-tap="flyer" aria-label="Copy the flyer"><img class="plsh-fly" alt="Flyer for ${esc(D.title)}" data-img="flyer"></button><p class="plsh-tap">Tap to copy</p></section>
        <section class="plsh-slide" aria-roledescription="slide" aria-label="3 of 3: QR code"><button type="button" class="plsh-pv" data-tap="qr" aria-label="Copy the QR code"><img class="plsh-qr" alt="QR code for the invite" data-img="qr"></button><p class="plsh-tap">Tap to copy</p></section>
      </div>
      <button type="button" class="plsh-nav p" aria-label="Previous">${IC.prev}</button><button type="button" class="plsh-nav n" aria-label="Next">${IC.next}</button>
      <div class="plsh-dots" role="group" aria-label="Formats">${S.map((s, i) => `<button type="button" data-dot="${i}" aria-label="${esc(s.label)}"${i ? "" : ' aria-current="true"'}></button>`).join("")}</div>
      <div class="plsh-row" role="group" aria-label="Send"></div><p class="plsh-live" role="status" aria-live="polite"></p></div>`;
    document.body.appendChild(bg); const track = $(".plsh-track", bg), row = $(".plsh-row", bg), live = $(".plsh-live", bg);
    const prevOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = "hidden";
    // what just happened is said in place, on the line under the preview, then it goes back to "Tap to copy"
    const tapOff = (l) => { l.textContent = "Tap to copy"; l.classList.toggle("on", false); };
    let nt = 0; const say = (t) => { live.textContent = t; const line = $$(".plsh-tap", bg)[Math.max(0, at)]; $$(".plsh-tap", bg).forEach(tapOff);
      if (line) { line.textContent = t; line.classList.toggle("on", true); } clearTimeout(nt); nt = setTimeout(() => line && tapOff(line), 2600); };
    const close = () => { bg.remove(); document.removeEventListener("keydown", key, true); document.documentElement.style.overflow = prevOverflow; try { /* back to what opened it; a tap leaves focus on the body, and the button may have been drawn again: then the page's heading */ const t = prev && prev !== document.body && prev.isConnected ? prev : [...document.querySelectorAll("#tk h2, main h1, main h2, h1, h2")].find((h) => h.getClientRects().length && !h.closest("[aria-modal]")); if (t && t !== prev && !t.hasAttribute("tabindex")) t.setAttribute("tabindex", "-1"); t?.focus?.({ preventScroll: true }); } catch {} opts.onClose?.(); };
    const key = (e) => { if (!bg.isConnected) return; if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !/TEXTAREA|INPUT/.test(e.target?.tagName || "")) { e.preventDefault(); go(at + (e.key === "ArrowRight" ? 1 : -1)); } };
    document.addEventListener("keydown", key, true); $(".plsh-x", bg).onclick = close; bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
    const tr = (t) => { try { opts.track?.(t); } catch {} };
    $("[data-dc]", bg) && ($("[data-dc]", bg).onclick = async () => { tr("discord"); if (await copyText(`**${D.title}**\n${[D.when, D.where].filter(Boolean).join(" · ")}\n${D.url}`)) say("Copied. Paste it in the channel"); });
    // the pictures, each made once
    const pic = await loadImg(D.cover), art = pic ? null : await artImage(opts.event || {}), B = {};
    const paint = async (k) => { if (B[k]) return B[k]; try { const c = k === "card" ? await linkCard(D, pic, art) : k === "flyer" ? await flyer(D, pic, art) : await qrCard(D); if (!c) return null;
      B[k] = await toBlob(c, k === "card" ? "image/jpeg" : "image/png", 0.9); api.last = B; const im = $(`[data-img="${k}"]`, bg); if (im && B[k]) im.src = URL.createObjectURL(B[k]); return B[k]; } catch { return null; } };
    paint("card").then((b) => { if (b && opts.onCard) { try { opts.onCard(b, D); } catch {} } }); setTimeout(() => { paint("flyer"); paint("qr"); }, 60);
    // the actions
    // Messages: sms:?&body= on iPhone, sms:?body= on Android; elsewhere the share sheet, then copy (friend invites use the same, public/invites.js)
    const UA = navigator.userAgent || "", droid = /Android/i.test(UA), isPhone = droid || /iPhone|iPad|iPod/i.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const smsTo = (m) => (droid ? "sms:?body=" : "sms:?&body=") + encodeURIComponent(m);
    const sms = async () => { tr("sms"); if (isPhone) { location.href = smsTo(msg); return; } if (navigator.share) { try { await navigator.share({ text: msg }); return; } catch (e) { if (e && e.name === "AbortError") return; } } if (await copyText(msg)) say("Copied. Paste it into a text"); };
    const more = async () => { tr("more"); if (navigator.share) { try { await navigator.share({ title: D.title, text: msg.replace(D.url, "").trim(), url: D.url }); return; } catch (e) { if (e?.name === "AbortError") return; } } if (await copyText(msg)) say("Copied. Paste it anywhere"); };
    // Instagram takes no link from a web page, so the link is copied and Instagram opens, ready to paste in a chat
    const insta = async () => { tr("instagram"); const ok = await copyText(D.url); say(ok ? "Link copied. Paste it in an Instagram chat" : "Opening Instagram");
      setTimeout(() => { if (phone()) location.href = "instagram://direct-inbox"; else window.open("https://www.instagram.com/direct/inbox/", "_blank", "noopener"); }, 500); };
    const img = async (k, how) => { const b = await paint(k); if (!b) return say("One second, it's still drawing"); const file = `${name}-${k}.png`; tr(how === "story" ? "story" : how === "save" ? "save" : how === "sms" ? "sms" : "more");
      if (how === "save") { if (phone() && (await shareFile(b, file))) return; download(b, file); return say(k === "qr" ? "QR code saved" : "Flyer saved"); }
      if (how === "story") { const ok = await copyText(D.url); if (await shareFile(b, file)) return; download(b, file); return say(ok ? "Saved. The link is copied for a link sticker" : "Saved. Add it to your story"); }
      if (await shareFile(b, file, { text: msg })) return; download(b, file); await copyText(msg); if (how === "sms") { say("Saved. Attach it in Messages"); if (isPhone) setTimeout(() => { location.href = smsTo(msg); }, 600); } else say("Saved, and the link is copied"); };
    // "Chats" (signed in only): the event or drop as a card in a direct message on Pottery Lab (public/dmstart.js, loaded on the tap)
    const dmId = /(?:^|;\s*)encore_in=1/.test(document.cookie) ? String(D.eventId || D.event?.id || (/\/e\/([A-Za-z0-9_-]{1,80})(?:[?#]|$)/.exec(D.url) || [])[1] || "") : "";
    const inChat = () => { tr("dm"); const go = () => { close(); window.PLDMStart.share({ type: "event", id: dmId, title: D.title }); }; if (window.PLDMStart) return go(); const t = document.createElement("script"); t.src = "/dmstart.js"; t.onload = go; document.head.appendChild(t); };
    const ROWS = {
      link: [["Copy link", IC.link, async () => { tr("copy"); if (await copyText(D.url)) say("Link copied"); }, 1], ["Messages", IC.sms, sms], ["Instagram", IC.ig, insta], ["WhatsApp", IC.wa, () => { tr("whatsapp"); window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener"); }], ...(dmId ? [["Chats", IC.chat, inChat]] : []), ["More", IC.more, more]],
      flyer: [["Save", IC.save, () => img("flyer", "save"), 1], ["Messages", IC.sms, () => img("flyer", "sms")], ["Stories", IC.story, () => img("flyer", "story")], ["More", IC.more, () => img("flyer", "more")]],
      qr: [["Save", IC.save, () => img("qr", "save"), 1], ["Messages", IC.sms, () => img("qr", "sms")], ["More", IC.more, () => img("qr", "more")]] };
    let at = -1; const drawRow = () => { const R = ROWS[S[at].k]; row.innerHTML = R.map(([l, ic, , pri], i) => `<button type="button" class="plsh-t${pri ? " pri" : ""}" data-t="${i}"><i>${ic}</i><span>${esc(l)}</span></button>`).join(""); $$("[data-t]", row).forEach((b) => (b.onclick = () => R[+b.dataset.t][2]())); };
    const setAt = (i) => { if (i === at) return; at = i; $("#plshH", bg).textContent = S[i].h; $("#plshP", bg).textContent = S[i].p; $$("[data-dot]", bg).forEach((d, j) => d.setAttribute("aria-current", String(j === i))); $(".plsh-nav.p", bg).disabled = i === 0; $(".plsh-nav.n", bg).disabled = i === S.length - 1; drawRow(); };
    const go = (i) => { i = Math.max(0, Math.min(S.length - 1, i)); track.scrollTo({ left: i * track.clientWidth, behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth" }); setAt(i); };
    let st = 0; track.addEventListener("scroll", () => { clearTimeout(st); st = setTimeout(() => setAt(Math.round(track.scrollLeft / Math.max(1, track.clientWidth))), 60); });
    $$("[data-dot]", bg).forEach((d) => (d.onclick = () => go(+d.dataset.dot))); $(".plsh-nav.p", bg).onclick = () => go(at - 1); $(".plsh-nav.n", bg).onclick = () => go(at + 1);
    $$("[data-tap]", bg).forEach((b) => (b.onclick = async () => { const k = b.dataset.tap;
      if (k === "link") { tr("copy"); if (await copyText(D.url)) say("Link copied"); return; }
      const blob = await paint(k); if (blob && (await copyImage(blob))) say(k === "qr" ? "QR code copied" : "Flyer copied"); else img(k, "save"); }));
    const first = Math.max(0, S.findIndex((s) => s.k === opts.start)); setAt(first); if (first) requestAnimationFrame(() => (track.scrollLeft = first * track.clientWidth));
    setTimeout(() => $("#plshH", bg)?.focus({ preventScroll: true }), 30);
    return { close, el: bg }; }

  const api = { open, linkCard: (d, pic, art) => linkCard(norm(d), pic, art), flyer: (d, pic, art) => flyer(norm(d), pic, art), qrCard: (d) => qrCard(norm(d)), norm };
  window.ShareKit = window.PLShare = api;
})();
