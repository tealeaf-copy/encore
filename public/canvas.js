// The create canvas: a new event is made on the invite itself, top to bottom, the way guests will see it.
// No steps and no review screen. Close top left, Save top right. Title (with four title styles), the cover (pencil:
// upload or pick a drawing), when as a sentence, host, co-hosts and place, the description, add-on blocks from a row of
// chips, the host's own sections, then the host-only part: who can find it and quick actions. A dock at the bottom holds
// Look, Effect and Settings. The same page edits an event later. A draft is kept on this device as you type.
// The first Save shares it (Private, Followers or Public) and opens the app's share entry (shareSheet).
// Data: the app's event doc (index.html's draft, saveEvent). Guest pages draw sections with public/sections.js.
(function (root) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // ================= the pure bits (test/create-canvas.test.js runs these without a page) =================
  // add-on chips, each mapped to the event field guests already see
  const ADDONS = [
    { k: "link", label: "Link", title: "Link", field: "links", icon: "link" },
    { k: "playlist", label: "Playlist", title: "Playlist", field: "playlistUrl", icon: "music" },
    { k: "bring", label: "What to bring", title: "What to bring", field: "bring", icon: "gift" },
    { k: "included", label: "What's included", title: "What's included", field: "included", icon: "star" }, // review 16: a workshop's materials, a trip's meals
    { k: "dress", label: "Dress code", title: "Dress code", field: "dress", icon: "shirt" },
    { k: "food", label: "Food", title: "Food", field: "courses", icon: "food" },
    { k: "parking", label: "Parking", title: "Parking and getting there", field: "getThere", icon: "car" },
    { k: "access", label: "Accessibility", title: "Accessibility", field: "accessNote", icon: "access" },
  ];
  const lines = (t) => String(t ?? "").split(/\n/).map((x) => x.trim()).filter(Boolean);
  const httpsOf = (u) => { u = String(u ?? "").trim(); if (!u) return ""; if (/^http:\/\//i.test(u)) u = "https://" + u.slice(7); if (!/^https:\/\//i.test(u) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(u)) u = "https://" + u; return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : ""; };
  /** The add-on's value as the text the host edits. */
  function addonText(d, k) { d = d || {};
    switch (k) {
      case "link": return (Array.isArray(d.links) ? d.links : []).map((l) => [l.label, l.url].filter(Boolean).join(" ")).join("\n");
      case "playlist": return d.playlistUrl || "";
      case "bring": return (Array.isArray(d.bring) ? d.bring : d.bring ? [d.bring] : []).join("\n");
      case "dress": return d.dress || "";
      case "food": return (Array.isArray(d.courses) ? d.courses : []).join("\n");
      case "parking": return (Array.isArray(d.getThere) ? d.getThere : []).map((s) => s?.x || "").filter(Boolean).join("\n");
      case "access": return d.accessNote || "";
      case "included": return (Array.isArray(d.included) ? d.included : []).join("\n");
    } return ""; }
  /** Write what the host typed into the add-on's field. Links: [{label,url}]; lists: one per line. */
  function addonSet(d, k, v) {
    switch (k) {
      case "link": d.links = (Array.isArray(v) ? v : []).map((l) => ({ label: String(l?.label || "").trim().slice(0, 60), url: String(l?.url || "").trim().slice(0, 500) })).filter((l) => l.label || l.url).slice(0, 6); break;
      case "playlist": d.playlistUrl = String(v ?? "").trim().slice(0, 500); break;
      case "bring": d.bring = lines(String(v ?? "").replace(/,\s*/g, "\n")).slice(0, 30); break;
      case "dress": d.dress = String(v ?? "").trim().slice(0, 80); break;
      case "food": d.courses = lines(v).slice(0, 12).map((x) => x.slice(0, 120)); break;
      case "parking": d.getThere = lines(v).slice(0, 8).map((x) => ({ t: "", x: x.slice(0, 200) })); break;
      case "access": d.accessNote = String(v ?? "").trim().slice(0, 300); break;
      case "included": d.included = lines(v).slice(0, 20).map((x) => x.slice(0, 120)); break;
    } return d; }
  const addonHas = (d, k) => k === "link" ? (Array.isArray(d?.links) && d.links.some((l) => l && (l.url || l.label))) : !!addonText(d, k).trim();
  /** Links and the playlist read as https links on save ("open.spotify.com/x" becomes "https://open.spotify.com/x"); a bad one is an error. */
  function addonFix(d) { const bad = [];
    if (d.playlistUrl) { const u = httpsOf(d.playlistUrl); if (u) d.playlistUrl = u; else bad.push("playlist"); }
    if (Array.isArray(d.links)) d.links = d.links.map((l) => { if (!l.url) return l; const u = httpsOf(l.url); if (!u) bad.push("link"); return { ...l, url: u || l.url }; });
    return bad; }

  // who can find it: the dropdown, and the fields it sets (published, discoverable, unlisted; lastVis for a draft)
  const VIS = [["link", "Private (link only)", "Only people you send the link to."], ["followers", "Followers", "On your page. People who follow you see it."], ["public", "Public on Discover", "On your page and Discover, so new people nearby can find it."]];
  // with a fan club on (server/fanclub.js), a fourth choice: members only, set through /api/host/club/events/:id
  const VIS_CLUB = ["club", "Fan club only", "Only members of your fan club can see it and reply."];
  const visList = (club) => (club ? [...VIS, VIS_CLUB] : VIS);
  const VIS_OLD = { link: "link", followers: "page", public: "discover", club: "link" };
  function visKey(d, club) { d = d || {}; if (club === "members") return "club"; const live = !!(d.published || d.discoverable);
    if (!live) return ({ link: "link", page: "followers", discover: "public" })[d.lastVis] || "link";
    return !d.discoverable ? "link" : d.unlisted ? "followers" : "public"; }
  /** Set who can find it. A draft only remembers the choice until it's shared (publish: true shares it). */
  function visApply(d, key, { publish = false } = {}) { if (!VIS_OLD[key]) key = "link"; d.lastVis = VIS_OLD[key];
    if (publish || d.published || d.discoverable) { d.published = true; d.discoverable = key === "followers" || key === "public"; d.unlisted = key !== "public"; }
    return d; }

  // title styles. Display is no title font of the event's own: the brand's display serif (--pl-font-display), or the
  // host's brand kit display face when they have a kit (public/brandkit.js). The others are looks.js title fonts.
  const TITLE_STYLES = [["display", "Display", ""], ["clean", "Clean", "clean"], ["mono", "Mono", "mono"], ["script", "Script", "script"]];
  const titleStyleOf = (d) => (TITLE_STYLES.find((s) => s[2] === (d?.look?.titleFont || "")) || [""])[0];
  // the ambient effect: off unless the host picks one, and still for people who prefer less motion (looks.js)
  const EFFECTS = [["none", "None", "Just the page.", "none"], ["grain", "Grain", "A soft paper texture.", "paper"], ["snow", "Soft snow", "A few slow flakes.", "snow"], ["glow", "Candlelight", "Warm points of light, barely moving.", "twinkle"]];
  const effectOf = (d) => (EFFECTS.find((x) => x[3] === (d?.look?.effect || "none")) || EFFECTS[0])[0];

  // "Thursday, Nov 26 · 7:00pm to 10:00pm"
  const HHMM = /^\d{2}:\d{2}$/;
  const clock = (t) => { if (!HHMM.test(t || "")) return ""; let [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")}${ap}`; };
  function dayLine(iso) { const d = /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? new Date(iso + "T12:00:00") : null; return d && !isNaN(d) ? d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : ""; }
  const shortDay = (iso) => { const d = /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? new Date(iso + "T12:00:00") : null; return d && !isNaN(d) ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : ""; };
  /** A feeler (stage "interest"): friends vote on up to three dates before anything is booked. */
  const isFeeler = (d) => d?.stage === "interest" && !d.date;
  function whenSentence(d) { d = d || {}; if (isFeeler(d)) { const o = (d.dateOptions || []).map(shortDay).filter(Boolean); return o.length ? `Asking friends · ${o.join(", ")}` : ""; }
    const day = dayLine(d.date); if (!day) return ""; const s = clock(d.startTime), e = s && d.endTime && d.endTime !== d.startTime ? clock(d.endTime) : "";
    const two = /^\d{4}-\d{2}-\d{2}$/.test(d.endDate || "") && d.endDate > d.date ? ` to ${dayLine(d.endDate)}` : "";
    return day + two + (s ? ` · ${s}${e && !two ? ` to ${e}` : ""}` : ""); }
  const TIMES = (() => { const T = []; for (let i = 0; i < 48; i++) { const m = (i * 30 + 6 * 60) % 1440; T.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`); } return T; })();

  // what Save checks first
  function missing(d) { if (!String(d?.pubTitle || d?.name || "").trim()) return "title"; if (!d.date && !(d.stage === "interest" && (d.dateOptions || []).length)) return "date"; return ""; }

  // the link preview a friend sees in a chat: the same title, line and picture as /e/<id>'s meta tags (server/app.js)
  function unfurlOf(d, host) { d = d || {}; const title = String(d.pubTitle || d.name || "").trim() || "You're invited";
    const when = /^\d{4}-\d{2}-\d{2}$/.test(d.date || "") ? new Date(d.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "";
    const time = HHMM.test(d.startTime || "") ? new Date("2000-01-01T" + d.startTime + ":00Z").toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }) : "";
    const line = [when && `${when}${time ? " · " + time : ""}`, d.hood || d.city || "", host ? `Hosted by ${host}` : ""].filter(Boolean).join(" · ");
    return { title, line: line || "You're invited." }; }
  /** The event as a guest page gets it: no address, no guest list, no host notes; sections cleaned. */
  function guestOf(d) { const e = JSON.parse(JSON.stringify(d || {})); for (const k of ["venueAddr", "guests", "notes", "budget", "tasks", "lastVis", "id"]) delete e[k]; if (root.EventSections) e.sections = root.EventSections.clean(e.sections); return e; }

  // review 16: a whole plan typed into the title ("Dinner at my place Saturday 7pm, 6 friends, I'm making dumplings")
  // can fill the date, time, place and spots in one tap, the way you'd text it to a friend. Pure; null when there's
  // too little to read. Dates are the next one on or after today, in the browser's own calendar.
  const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  function planFromLine(text, now = new Date()) { const t = String(text || "").replace(/\s+/g, " ").trim(); if (t.length < 16) return null; const lo = t.toLowerCase(), o = {}, cut = [];
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const wd = /\b(?:this |next )?(sun|mon|tue|wed|thu|fri|sat)(?:day|s|nes|nesday|rs|rsday|ur|urday|sday)?\b(?: night| morning| afternoon| evening)?/i.exec(t);
    const rel = /\b(tonight|tomorrow(?: night)?)\b/i.exec(t);
    if (wd) { const k = WD.indexOf(wd[1].toLowerCase()), d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); let add = (k - d.getDay() + 7) % 7; if (/^next /i.test(wd[0]) && add < 7) add += add ? 0 : 7; d.setDate(d.getDate() + add); o.date = iso(d); cut.push(wd.index); }
    else if (rel) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (/^tomorrow/i.test(rel[1]) ? 1 : 0)); o.date = iso(d); cut.push(rel.index); }
    const tm = /\b(?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(t) || /\bat (\d{1,2})(?::(\d{2}))?\b(?!\s*(?:people|friends|guests|seats))/i.exec(t);
    if (tm) { let h = +tm[1]; const m = tm[2] || "00", ap = (tm[3] || "").toLowerCase(); if (h >= 1 && h <= 23) { if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; if (!ap && h < 8) h += 12; o.startTime = `${String(h).padStart(2, "0")}:${m}`; cut.push(tm.index); if (/^tonight/i.test(rel?.[1] || "") && !o.date) o.date = iso(now); } }
    const pl = /\bat (my|our) (place|apartment|flat|house|home)\b/i.exec(t) || /\b(?:at|in) ((?:the )?[A-Z][\w'&-]*(?: [A-Z][\w'&-]*){0,3})/.exec(t);
    if (pl) o.meetPoint = pl[2] ? `${pl[1][0].toUpperCase() + pl[1].slice(1).toLowerCase()} ${pl[2].toLowerCase()}` : pl[1];
    const n = /\b(\d{1,3})\s*(?:friends|people|guests|seats|spots)\b/i.exec(t); if (n && +n[1] >= 2) o.headcount = +n[1];
    if ((o.date ? 1 : 0) + (o.startTime ? 1 : 0) + (o.meetPoint ? 1 : 0) + (o.headcount ? 1 : 0) < 2) return null;
    // the title: what comes before the first date, time or comma; the rest, if it says something, is the description
    const first = Math.min(...cut.filter((x) => x > 3), lo.indexOf(",") > 3 ? lo.indexOf(",") : Infinity);
    let title = (Number.isFinite(first) ? t.slice(0, first) : t).replace(/[\s,.-]+(?:on|at|this|next)?$/i, "").trim(); if (title.length < 3) title = t.split(",")[0].trim();
    const rest = t.split(",").slice(1).map((x) => x.trim()).filter((x) => x && !/^\d{1,3}\s*(friends|people|guests|seats|spots)$/i.test(x) && !/^(?:on )?(sun|mon|tue|wed|thu|fri|sat)/i.test(x) && !/^\d{1,2}(:\d{2})?\s*(am|pm)$/i.test(x));
    return { title: title.charAt(0).toUpperCase() + title.slice(1), ...o, ...(rest.length ? { why: rest.join(". ").replace(/^./, (c) => c.toUpperCase()).replace(/([^.!?])$/, "$1.") } : {}) }; }
  /** The button's words: "Fill in Sat, Dec 5, 7pm and My place". */
  function planLineLabel(p) { if (!p) return ""; const bits = [p.date ? new Date(p.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "", p.startTime ? clock(p.startTime).replace(":00", "") : "", p.meetPoint || "", p.headcount ? `${p.headcount} spots` : ""].filter(Boolean);
    return "Fill in " + (bits.length > 1 ? bits.slice(0, -1).join(", ") + " and " + bits[bits.length - 1] : bits[0]); }

  const pure = { planFromLine, planLineLabel, ADDONS, addonText, addonSet, addonHas, addonFix, httpsOf, VIS, VIS_CLUB, visList, visKey, visApply, TITLE_STYLES, titleStyleOf, EFFECTS, effectOf, whenSentence, clock, TIMES, missing, isFeeler, unfurlOf, guestOf };
  root.EventCanvas = { ...pure };
  if (typeof document === "undefined") return;

  // ================= the page =================
  const q = (s, el = document) => el.querySelector(s), qa = (s, el = document) => [...el.querySelectorAll(s)];
  const G = 'viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const I = { x: `<svg ${G}><path d="M5 5l10 10M15 5 5 15"/></svg>`, pen: `<svg ${G}><path d="M13.5 3.5l3 3L7 16H4v-3z"/></svg>`, plus: `<svg ${G}><path d="M10 4v12M4 10h12"/></svg>`,
    chev: `<svg ${G}><path d="m7.5 4.5 5.5 5.5-5.5 5.5"/></svg>`, pin: `<svg ${G}><path d="M10 17.5c-3.6-4.2-5.4-7.2-5.4-9.6a5.4 5.4 0 0 1 10.8 0c0 2.4-1.8 5.4-5.4 9.6z"/><circle cx="10" cy="7.9" r="2"/></svg>`,
    cal: `<svg ${G}><rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M3 8.5h14M7 3v3M13 3v3"/></svg>`, look: `<svg ${G}><circle cx="10" cy="10" r="7"/><path d="M10 3a7 7 0 0 0 0 14z" fill="currentColor"/></svg>`,
    fx: `<svg ${G}><path d="M10 3v2.5M10 14.5V17M3 10h2.5M14.5 10H17M5 5l1.7 1.7M13.3 13.3 15 15M15 5l-1.7 1.7M6.7 13.3 5 15"/></svg>`, cog: `<svg ${G}><path d="M4 6h8M15 6h1M4 14h1M8 14h8"/><circle cx="13.5" cy="6" r="1.6"/><circle cx="6.5" cy="14" r="1.6"/></svg>`,
    q: `<svg ${G}><circle cx="10" cy="10" r="7"/><path d="M8 8a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5M10 14h.01"/></svg>`, bell: `<svg ${G}><path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.5h-13zM8.5 17h3"/></svg>`,
    lock: `<svg ${G}><rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg>`, more: `<svg ${G}><path d="M4.5 10h.01M10 10h.01M15.5 10h.01" stroke-width="2.6"/></svg>`,
    check: `<svg ${G}><path d="M4.5 10.5 8 14l7.5-8"/></svg>`, up: `<svg ${G}><path d="M10 15V4M5.5 8.5 10 4l4.5 4.5"/></svg>` };
  const SX = () => root.EventSections || { ICONS: {}, PICK: ["note"], svg: () => "", clean: (x) => x || [] };
  // the app's own functions are globals on the page; the open event (a script-level let) comes through HostEvent
  const app = (n) => (typeof root[n] === "function" ? root[n] : null);
  const getDraft = () => { try { return root.HostEvent?.draft?.() || null; } catch { return null; } };
  const setDraft = (d) => { try { root.HostEvent?.useDraft?.(d); } catch (e) { console.warn(e); } };
  const say = (m) => { try { app("toast")?.(m); } catch {} };
  const clone = (o) => JSON.parse(JSON.stringify(o || {}));
  const touch = () => !!root.matchMedia?.("(pointer: coarse)").matches;
  let S = null, PROFILE = null;
  // the host (name, picture, brand kit) as the invite shows them, and their fan club, once per page
  let HOSTCARD = null, CLUB = null;
  const getJ = (u) => fetch(u, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const profile = () => PROFILE ? Promise.resolve(PROFILE) : Promise.all([getJ("/api/host/profile"), getJ("/api/host/invite-host"), getJ("/api/host/club")])
    .then(([p, h, c]) => { HOSTCARD = h || { host: null }; CLUB = c?.club?.on ? { on: true, events: c.events || [] } : null; return (PROFILE = p?.host || {}); });
  const kitFont = () => { const BK = root.EncoreBrandKit, k = HOSTCARD?.host?.kit; try { return k && BK && !BK.isHouse(k) ? BK.fonts(k) : null; } catch { return null; } };

  // ---------- a fresh event ----------
  function fresh() { let d = {}; try { const hy = app("hydrate"), bd = app("brandDraft"); if (hy && bd) d = hy(bd({ kind: "social" })); } catch (e) { console.warn(e); }
    return Object.assign(d, { id: null, example: false, name: "", pubTitle: "", casual: true, kind: "social", objective: "awareness", noMaybe: false, openRsvp: true, showWho: true,
      published: false, discoverable: false, unlisted: true, lastVis: "link", date: "", startTime: "", endTime: "", meetPoint: "", venueName: "", venueAddr: "", city: PROFILE?.city || "", headcount: 0,
      why: "", concept: "", effect: "none", theme: "", titleFont: "", look: {}, guests: [], autoRemind: true, sections: [] }); }
  const KEY_NEW = "encore.canvas.new", keyOf = (d) => (d?.id ? "encore.canvas." + d.id : KEY_NEW);
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} } };

  /** Open the canvas. mode: "new" (a fresh event), or edit the open event (draft). */
  async function open(o = {}) { await profile(); close(true);
    const cur = getDraft(), editing = o.mode !== "new" && cur && !cur.example && (cur.id || o.mode);
    let W = editing ? clone(cur) : fresh(), note = "";
    const key = keyOf(editing ? cur : null), kept = ls.get(key);
    if (kept?.d && (editing ? kept.base === (cur.updatedAt || null) : (kept.d.pubTitle || kept.d.date || kept.d.why))) { W = { ...W, ...kept.d, id: W.id }; note = editing ? "Your unsaved changes are back." : "Picked up your draft from earlier."; }
    if (!editing && W.effect === "confetti") W.effect = "none";
    const club = (editing && CLUB?.events?.find((x) => x.id === cur.id)?.visibility) || "everyone";
    S = { W, orig: editing ? cur : null, isNew: !(W.published || W.discoverable), key, dirty: !!note, note, base: editing ? cur.updatedAt || null : null, open: new Set(ADDONS.filter((a) => addonHas(W, a.k)).map((a) => a.k)),
      club, clubWas: club, mode: "edit" };
    if (kept?.club) S.club = kept.club;
    build(); }

  function close(quiet) { if (!S?.el) return; S.el.__lkStop?.(); S.el.remove(); document.body.classList.remove("cv-open"); qa(".cv-sh-bg").forEach((x) => x.remove()); if (!quiet) S = null; else S.el = null; }

  // ---------- drawing ----------
  function coverHTML(W) { const u = app("safeCover")?.(W.coverPhoto) || (/^\/_blob\/|^https:\/\//.test(W.coverPhoto || "") ? W.coverPhoto : ""), A = root.EventArt;
    if (u) return `<img src="${esc(u)}" alt="" style="object-position:${esc(W.coverPos || "50% 50%")}">`;
    if (A) { try { A.ensureCss?.(); return A.cover({ ...W, title: W.pubTitle || W.name || "" }, { title: "", label: "" }); } catch {} } return ""; }
  function hostName() { return String(PROFILE?.name || root.ENCORE_ME?.name || "You").trim(); }
  function cohostLine(W) { const C = (W.cohosts || []).map((c) => c.name || (c.handle ? "@" + c.handle : "")).filter(Boolean); return C.length ? ` <span class="cv-with">with ${esc(C.join(", "))}</span>` : ""; }
  function addonBlock(W, a) { const ic = SX().svg(a.icon), rm = `<button type="button" class="cv-rm" data-rm="${a.k}" aria-label="Remove ${esc(a.title.toLowerCase())}">${I.x}</button>`;
    let body = "";
    if (a.k === "link") { const L = (W.links || []).length ? W.links : [{ label: "", url: "" }];
      body = L.map((l, i) => `<div class="cv-two"><input data-link="${i}" data-lf="label" value="${esc(l.label)}" placeholder="What it is, like Group chat" maxlength="60" aria-label="Link name"><input data-link="${i}" data-lf="url" value="${esc(l.url)}" placeholder="https://" inputmode="url" autocapitalize="off" aria-label="Link address"></div>`).join("") + (L.length < 3 ? `<button type="button" class="cv-text-btn" data-cv="link-more">${I.plus}<span>Another link</span></button>` : ""); }
    else if (a.k === "playlist") body = `<input data-af="playlist" value="${esc(W.playlistUrl || "")}" placeholder="Paste a Spotify or Apple Music link" inputmode="url" autocapitalize="off" aria-label="Playlist link">`;
    else if (a.k === "dress") body = `<input data-af="dress" value="${esc(W.dress || "")}" placeholder="Come as you are, or something green" maxlength="80" aria-label="Dress code">`;
    else { const ph = { bring: "One per line. Snacks, a drink to share", food: "One per line. Starter: Pandan madeleines", parking: "Street parking on Elm. The 2 train stops a block away.", access: "Step-free entry, an elevator to the third floor", included: "One per line. Clay and glazes, an apron, firing and pickup in two weeks" }[a.k];
      body = `<textarea data-af="${a.k}" rows="2" placeholder="${esc(ph)}" aria-label="${esc(a.title)}">${esc(addonText(W, a.k))}</textarea>`; }
    return `<section class="cv-blk" data-addon="${a.k}"><header>${ic}<h3>${esc(a.title)}</h3>${rm}</header>${body}</section>`; }
  function sectionBlock(s, i) { return `<section class="cv-blk cv-own" data-sec="${i}"><header>${SX().svg(s.icon)}<h3>${esc(s.title || "A note")}</h3><button type="button" class="cv-rm cv-ed" data-secedit="${i}" aria-label="Edit ${esc(s.title || "section")}">${I.pen}</button></header>${s.body ? `<p>${esc(s.body).replace(/\n/g, "<br>")}</p>` : ""}</section>`; }
  function pills(W) { const n = (W.questions || []).length || (W.askQ ? 1 : 0);
    return [["questions", I.q, n ? `Questions (${n})` : "Add questions", n > 0], ["reminders", I.bell, "Reminders", W.autoRemind !== false], ["approval", I.lock, "Require approval", !!W.approvalRequired], ["more", I.more, "More", false]]
      .map(([k, ic, t, on]) => `<button type="button" class="cv-pill${on ? " on" : ""}" data-qa="${k}">${on && k !== "questions" ? I.check : ic}<span>${t}</span></button>`).join(""); }

  // the link preview friends see in a chat, drawn live (unfurlOf above mirrors the server's meta tags)
  function unfurlHTML(W) { const U = unfurlOf(W, hostName()), u = app("safeCover")?.(W.coverPhoto) || (/^\/_blob\/|^https:\/\//.test(W.coverPhoto || "") ? W.coverPhoto : ""), A = root.EventArt;
    let kind = "party"; try { kind = String((W.coverArt?.kind && A?.valid(W.coverArt.kind) ? W.coverArt.kind : A?.kindOf({ ...W, title: U.title })) || "party").split("+")[0]; } catch {}
    return `<div class="cv-uf"><img src="${esc(u || "/og/" + kind + ".png")}" alt="" onerror="this.onerror=null;this.src='/og/party.png'"><div><b>${esc(U.title)}</b><span>${esc(U.line)}</span><small>${esc(location.host)}</small></div></div>`; }
  const replyWords = (W) => (W.approvalRequired ? ["Ask to join"] : isFeeler(W) ? ["I'm in", "Maybe", "Can't go"] : W.noMaybe ? ["I'm in", "Can't go"] : ["I'm in", "Maybe", "Can't go"]);
  function pageHTML() { const W = S.W, st = titleStyleOf(W), when = whenSentence(W), [wd, wt] = when.split(" · "), place = String(W.meetPoint || W.venueName || "").trim(), V = visKey(W, S.club), F = isFeeler(W), KF = kitFont();
    return `${S.note ? `<p class="cv-note" role="status"><span>${esc(S.note)}</span>${S.orig ? "" : `<button type="button" class="cv-text-btn" data-cv="fresh">Start fresh</button>`}</p>` : ""}
      <p class="cv-tag"><span class="cv-dot g"></span>Guests see this page. Tap anything to change it.<button type="button" class="cv-text-btn" data-mode="guest">Preview as guest</button></p>
      <div class="cv-cover cv-ed" id="cvCover">${coverHTML(W)}<button type="button" class="cv-pen" data-cv="cover" aria-label="Change the cover">${I.pen}<span>Cover</span></button></div>
      <div class="cv-ed cv-tw"><label class="vh" for="cvTitle">Event title</label><textarea id="cvTitle" class="cv-title" rows="1" maxlength="90" placeholder="Untitled event" enterkeyhint="done">${esc(W.pubTitle || W.name || "")}</textarea></div>
      <p class="cv-err" id="cvTitleErr" role="alert"></p><button type="button" class="cv-fromline cv-ed" id="cvFromLine" hidden></button>
      <div class="cv-styles" role="radiogroup" aria-label="Title style">${TITLE_STYLES.map(([k, l, f]) => { const ff = f ? root.EncoreLooks?.FONTS?.[f]?.css : KF?.display || "var(--pl-font-display)"; return `<button type="button" role="radio" aria-checked="${st === k}" data-style="${k}" style="font-family:${esc(ff || "inherit")}">${f ? l : KF ? "Your kit" : l}</button>`; }).join("")}</div>
      <button type="button" class="cv-when cv-ed${when ? "" : " empty"}" data-cv="when" id="cvWhen">${when ? (F ? `<small>A feeler. Nothing's booked yet.</small><b>Friends pick a date</b><span>${esc(when.replace(/^Asking friends · /, ""))}</span>` : `<b>${esc(wd)}</b>${wt ? `<span>${esc(wt)}</span>` : ""}`) : `<b>Pick a date and time</b><span>Or ask friends which date works first</span>`}</button>
      <div class="cv-rows">
        <div class="cv-row"><span class="cv-av" style="--c:${esc(PROFILE?.color || "#E3D7BE")}">${PROFILE?.avatarUrl ? `<img src="${esc(PROFILE.avatarUrl)}" alt="">` : esc(hostName().slice(0, 1).toUpperCase())}</span><span class="cv-rt"><small>Hosted by</small><b>${esc(hostName())}${cohostLine(W)}</b></span><button type="button" class="cv-mini" data-cv="cohost">${I.plus}<span>Co-host</span></button></div>
        <button type="button" class="cv-row cv-ed" data-cv="place" id="cvPlace"><span class="cv-ic">${I.pin}</span><span class="cv-rt"><small>Where</small>${place ? `<b>${esc(place)}</b>${W.city ? `<em>${esc(W.city)}</em>` : ""}` : `<b class="ph">Add a place</b>`}</span>${I.chev}</button>
      </div>
      <div class="cv-ed"><label class="vh" for="cvDesc">Description</label><textarea id="cvDesc" class="cv-desc" rows="3" maxlength="600" placeholder="Say what it is, who it's for and what to expect.">${esc(W.why || "")}</textarea></div>
      <div class="cv-blocks" id="cvBlocks">${ADDONS.filter((a) => S.open.has(a.k)).map((a) => addonBlock(W, a)).join("")}${SX().clean(W.sections).map(sectionBlock).join("")}</div>
      ${ADDONS.some((a) => !S.open.has(a.k)) ? `<div class="cv-chips" role="group" aria-label="Add to the invite">${ADDONS.filter((a) => !S.open.has(a.k)).map((a) => `<button type="button" class="cv-chip" data-add="${a.k}">${I.plus}<span>${esc(a.label)}</span></button>`).join("")}</div>` : ""}
      <div class="cv-moresay"><span>More to say?</span><button type="button" class="cv-mini" data-cv="section">${I.plus}<span>New section</span></button></div>
      <div class="cv-reply" id="cvReply"><p>${F ? "Would you come?" : W.approvalRequired ? "Want in?" : "Are you in?"}</p><div>${replyWords(W).map((t) => `<span>${esc(t)}</span>`).join("")}</div></div>
      <div class="cv-host">
        <p class="cv-tag"><span class="cv-dot"></span>Only you see this part</p>
        <div class="cv-field"><span>How the link looks in a chat</span>${unfurlHTML(W)}<small>Friends see this card when you send the link.</small></div>
        <label class="cv-field"><span>Who can find this event?</span><select id="cvVis">${visList(CLUB?.on).map(([k, l]) => `<option value="${k}"${k === V ? " selected" : ""}>${esc(l)}</option>`).join("")}</select><small id="cvVisHint">${esc(visList(true).find((x) => x[0] === V)[2])}</small></label>
        <div class="cv-qa"><span class="cv-qa-h">Quick actions for hosts</span><div class="cv-pills">${pills(W)}</div></div>
      </div>`; }

  function build() { document.body.classList.add("cv-open"); const el = document.createElement("div"); el.id = "cv"; el.className = "kit-off"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", S.isNew ? "New event" : "Edit event");
    el.innerHTML = `<header class="cv-top"><button type="button" class="cv-x" data-cv="close" aria-label="Close">${I.x}</button>
        <div class="cv-mode" role="group" aria-label="View"><button type="button" data-mode="edit" aria-pressed="true">Edit</button><button type="button" data-mode="guest" aria-pressed="false">Guest view</button></div>
        <button type="button" class="cv-save" data-cv="save">Save</button></header>
      <p class="cv-state" id="cvState" role="status">${stateLine()}</p>
      <div class="cv-body">
        <div class="cv-left"><div class="cv-scroll" id="cvScroll"><main class="cv-page" id="cvPage"></main></div>
        <nav class="cv-dock" aria-label="Page tools"><button type="button" data-cv="look">${I.look}<span>Look</span></button><button type="button" data-cv="effect">${I.fx}<span>Effect</span></button><button type="button" data-cv="settings">${I.cog}<span>Settings</span></button></nav></div>
        <aside class="cv-guest" aria-label="What guests see"><p class="cv-glab"><span class="cv-dot g"></span>What guests see. Live, with replies turned off.</p><div class="cv-phone"><iframe id="cvFrame" src="/e/_preview" title="Your invite, as guests see it"></iframe></div></aside>
      </div>`;
    document.body.appendChild(el); S.el = el; css(); draw(); wire(el);
    if (!touch() && !String(S.W.pubTitle || "").trim()) setTimeout(() => q("#cvTitle", el)?.focus(), 60); }
  function stateLine() { const live = !S.isNew; return S.dirty ? (live ? "Not saved yet. Guests see changes after you save." : "Draft, saved on this device. Only you can see it.") : live ? "Live. Guests see changes after you save." : "Draft. Only you can see it."; }
  function draw(keepScroll = true) { const sc = q("#cvScroll", S.el), y = sc.scrollTop; q("#cvPage", S.el).innerHTML = pageHTML(); grow(q("#cvTitle", S.el)); grow(q("#cvDesc", S.el)); qa("[data-af],[data-link]", S.el).forEach(grow); dress(); if (keepScroll) sc.scrollTop = y; preview(); }
  function grow(t) { if (!t || t.tagName !== "TEXTAREA") return; t.style.height = "auto"; t.style.height = t.scrollHeight + 2 + "px"; }
  // the look: colours, the title font and the effect, drawn by looks.js on the page itself; the Display style is the
  // brand's display serif, or the host's brand kit display face
  function dress() { const sc = q("#cvScroll", S.el), LK = root.EncoreLooks, F = LK?.FONTS?.[S.W.look?.titleFont], KF = kitFont();
    try { if (LK) { Object.values(FONTN).forEach((f) => f && LK.loadFont?.(f)); LK.apply(sc, { ...S.W, look: S.W.look || {} }, { fixed: true, page: true }); } } catch (e) { console.warn(e); }
    if (KF) { try { root.EncoreBrandKit?.loadFonts?.(HOSTCARD.host.kit); } catch {} }
    const t = q("#cvTitle", S.el); if (t) { t.style.fontFamily = F ? F.css : KF?.display || "var(--pl-font-display)"; t.style.fontWeight = F ? F.w : KF?.dw || 400; t.style.letterSpacing = F ? F.ls : KF?.dls || "var(--pl-display-track)"; t.style.setProperty("--tk", F ? F.k : KF?.dk || 1.08); grow(t); } }
  const FONTN = Object.fromEntries(TITLE_STYLES.map(([k, , f]) => [k, f]));

  // ---------- the live guest preview: the real invite page in a frame (/e/_preview, public/invite-preview.js) ----------
  const FLASH = { title: "#m h1", cover: "#m .cov", when: "#m .facts", place: "#m .facts", desc: "#m .why", sections: "#evSections", reply: "#f", look: "#m h1" };
  let pvT = 0, pvReady = false, pvFlash = "";
  function preview(what) { if (what) pvFlash = what; clearTimeout(pvT); pvT = setTimeout(() => { const f = S?.el && q("#cvFrame", S.el); if (!f || !pvReady) return;
    try { f.contentWindow.postMessage({ plPreview: { e: guestOf({ ...S.W, hostName: S.W.hostName || hostName() }), H: HOSTCARD || {}, flash: FLASH[pvFlash] || "", scroll: !!pvFlash && S.mode === "guest" } }, location.origin); } catch {} pvFlash = ""; }, 120); }
  addEventListener("message", (m) => { if (m.origin === location.origin && m.data?.plPreviewReady && S?.el && m.source === q("#cvFrame", S.el)?.contentWindow) { pvReady = true; preview(); } });
  // a quiet pulse on what just changed, here and in the guest preview
  function pulse(sel, what) { const n = typeof sel === "string" ? q(sel, S.el) : sel; if (n) { n.classList.remove("cv-pulse"); void n.offsetWidth; n.classList.add("cv-pulse"); } preview(what); }
  function setMode(m) { S.mode = m; S.el.classList.toggle("guest", m === "guest"); qa(".cv-mode [data-mode]", S.el).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m))); preview(); if (m === "guest") q(".cv-mode [data-mode=guest]", S.el)?.focus({ preventScroll: true }); }

  // ---------- autosave on this device ----------
  let saveT = 0;
  function changed(redraw) { S.dirty = true; clearTimeout(saveT); saveT = setTimeout(() => { if (!S) return; ls.set(S.key, { at: Date.now(), base: S.base, d: S.W, club: S.club }); const st = S.el && q("#cvState", S.el); if (st) st.textContent = stateLine(); }, 350); if (redraw) draw(); else preview(); }

  function wire(el) {
    el.addEventListener("input", (e) => { const t = e.target, W = S.W;
      if (t.id === "cvTitle") { pvFlash = "title"; W.pubTitle = t.value.replace(/\n/g, " "); W.name = W.pubTitle; if (t.value.includes("\n")) t.value = W.pubTitle; grow(t); q("#cvTitleErr", el).textContent = "";
        { const fb = q("#cvFromLine", el); clearTimeout(fb?.__t); if (fb) fb.__t = setTimeout(() => { const P = planFromLine(t.value); fb.hidden = !P || (!!W.date && !!W.startTime && !!(W.meetPoint || W.venueName)); if (P) { fb.textContent = planLineLabel(P); fb.__p = P; } }, 400); } const cov = q("#cvCover", el); if (cov && !W.coverPhoto && !W.coverArt?.kind) { clearTimeout(t.__c); t.__c = setTimeout(() => { const pen = q(".cv-pen", cov); cov.innerHTML = coverHTML(W); cov.appendChild(pen); }, 500); } }
      else if (t.id === "cvDesc") { W.why = t.value; grow(t); pvFlash = "desc"; }
      else if (t.dataset.af) { addonSet(W, t.dataset.af, t.value); grow(t); pvFlash = "sections"; }
      else if (t.dataset.link) { const L = (W.links || []).length ? W.links.map((x) => ({ ...x })) : [{ label: "", url: "" }]; while (L.length <= +t.dataset.link) L.push({ label: "", url: "" }); L[+t.dataset.link][t.dataset.lf] = t.value; W.links = L.map((l) => ({ label: l.label.slice(0, 60), url: l.url.slice(0, 500) })); }
      else return; changed(); });
    el.addEventListener("keydown", (e) => { if (e.target.id === "cvTitle" && e.key === "Enter") { e.preventDefault(); e.target.blur(); } if (e.key === "Escape" && !q(".cv-sh-bg")) tryClose(); });
    el.addEventListener("change", (e) => { if (e.target.id === "cvVis") { setVis(e.target.value); q("#cvVisHint", el).textContent = visList(true).find((x) => x[0] === e.target.value)[2]; } });
    el.addEventListener("focusout", (e) => { const t = e.target; if (t.dataset.af === "playlist" || t.dataset.lf === "url") { const u = httpsOf(t.value); if (u && u !== t.value) { t.value = u; t.dispatchEvent(new Event("input", { bubbles: true })); } } });
    el.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b || !el.contains(b)) return; const W = S.W;
      if (b.dataset.mode) return setMode(b.dataset.mode);
      if (b.dataset.style) { const L = { ...(W.look || {}) }; if (FONTN[b.dataset.style]) L.titleFont = FONTN[b.dataset.style]; else delete L.titleFont; W.look = L; W.titleFont = ""; qa("[data-style]", el).forEach((x) => x.setAttribute("aria-checked", String(x === b))); dress(); changed(); pulse(".cv-tw", "title"); return; }
      if (b.dataset.add) { S.open.add(b.dataset.add); pvFlash = "sections"; changed(true); const blk = q(`[data-addon="${b.dataset.add}"]`, el); blk?.scrollIntoView({ block: "center", behavior: "smooth" }); blk?.classList.add("new"); setTimeout(() => q("input,textarea", blk)?.focus({ preventScroll: true }), 250); return; }
      if (b.dataset.rm) { const k = b.dataset.rm; S.open.delete(k); addonSet(W, k, k === "link" ? [] : ""); changed(true); return; }
      if (b.dataset.secedit) return sectionSheet(+b.dataset.secedit);
      if (b.id === "cvFromLine") { const P = b.__p || planFromLine(W.pubTitle); if (!P) return; W.pubTitle = W.name = P.title; for (const k of ["date", "startTime", "meetPoint"]) if (P[k] && !W[k]) W[k] = P[k]; if (P.headcount && !+W.headcount) W.headcount = P.headcount; if (P.why && !String(W.why || "").trim()) W.why = P.why;
        try { app("applyPlace")?.(W); } catch {} changed(true); say("Filled in. Tap anything to change it."); return; }
      if (b.dataset.qa) return quick(b.dataset.qa);
      switch (b.dataset.cv) {
        case "close": return tryClose();
        case "save": return save();
        case "cover": return coverSheet();
        case "when": return whenSheet();
        case "place": return placeSheet();
        case "cohost": return cohostSheet();
        case "section": return sectionSheet(-1);
        case "look": return lookSheet();
        case "effect": return effectSheet();
        case "settings": return settingsSheet();
        case "link-more": { W.links = [...(W.links || []).filter((l) => l.label || l.url), { label: "", url: "" }]; changed(true); const ins = qa('[data-lf="label"]', el); ins[ins.length - 1]?.focus(); return; }
        case "fresh": { ls.del(S.key); S.W = fresh(); S.note = ""; S.open = new Set(); S.dirty = false; draw(false); return; }
      } }); }

  // ---------- sheets ----------
  function sheet({ title, sub = "", body, foot = "", wide = false, onClose }) { const bg = document.createElement("div"); bg.className = "cv-sh-bg";
    bg.innerHTML = `<div class="cv-sh${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div><button type="button" class="cv-x" data-x aria-label="Close">${I.x}</button></header><div class="cv-sh-body">${body}</div>${foot ? `<footer>${foot}</footer>` : ""}</div>`;
    document.body.appendChild(bg); const back = document.activeElement;
    const close = () => { bg.remove(); try { back?.focus?.({ preventScroll: true }); } catch {} onClose?.(); };
    bg.addEventListener("click", (e) => { if (e.target === bg || e.target.closest("[data-x]")) close(); });
    bg.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    setTimeout(() => { const f = !touch() && q(".cv-sh-body input:not([type=file]):not([type=radio]),.cv-sh-body textarea", bg); (f || q("[data-x]", bg))?.focus({ preventScroll: true }); }, 30);
    return { bg, close, $: (s) => q(s, bg), $$: (s) => qa(s, bg) }; }
  const sw = (id, on, label, sub) => `<div class="cv-sw"><span><b id="${id}L">${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span><button type="button" role="switch" id="${id}" aria-checked="${!!on}" aria-labelledby="${id}L"><i></i></button></div>`;
  const wireSw = (Sh, id, fn) => { const b = Sh.$("#" + id); if (b) b.onclick = () => { const v = b.getAttribute("aria-checked") !== "true"; b.setAttribute("aria-checked", String(v)); fn(v); }; };
  const done = (label = "Done") => `<button type="button" class="cv-b pri" data-done>${esc(label)}</button>`;

  // the cover: the shared "Change photo" sheet (public/photosheet.js): upload and drag to frame it, a recent upload, or one
  // of this event's drawn covers. It hands the choice back; the canvas keeps it until Save, like everything else here.
  async function coverSheet() { const W = S.W, P = root.PhotoSheet; if (!P) return say("One moment, the photo picker is loading.");
    const tpl = app("coverTemplates"); let templates; try { templates = tpl ? tpl({ ...W, coverPhoto: W.coverPhoto || "" }) : undefined; } catch {}
    await P.open({ for: "cover", eventId: W.id || "", current: { url: app("safeCover")?.(W.coverPhoto) || "", source: app("safeCover")?.(W.coverSource) || "", focus: W.coverFocus || null }, templates,
      onChange: async (c) => { const A = root.EventArt;
        if (c.removed) Object.assign(W, { coverPhoto: "", coverSource: "", coverFocus: null });
        else if (c.template) Object.assign(W, { coverPhoto: "", coverSource: "", coverFocus: null, coverArt: { kind: c.template, tone: A ? A.toneOf({ ...W, title: W.pubTitle || W.name || "" }, c.template) : "" } });
        else Object.assign(W, { coverPhoto: c.url, coverSource: c.source, coverFocus: c.focus, coverArt: null });
        changed(true); pulse("#cvCover", "cover"); } }); }

  function nextDays() { const out = [], t = new Date(); t.setHours(12, 0, 0, 0); const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    for (const wd of [5, 6, 0]) { const d = new Date(t); d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7 || 7)); out.push([iso(d), d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })]); } return out.sort((a, b) => a[0].localeCompare(b[0])); }
  const timeSel = (id, cur, none) => `<select id="${id}">${none ? `<option value="">${esc(none)}</option>` : ""}${(cur && !TIMES.includes(cur) ? [cur, ...TIMES] : TIMES).map((t) => `<option value="${t}"${t === cur ? " selected" : ""}>${clock(t)}</option>`).join("")}</select>`;
  // when: a date and time, or a feeler (friends vote on up to three dates before anything is booked; the full invite
  // shows them "Would you come?" and the host calls it from the event page)
  function whenSheet(why, feel) { const W = S.W; feel = feel ?? isFeeler(W); const opts = [...(W.dateOptions || [])].slice(0, 3); while (opts.length < 3) opts.push("");
    const Sh = sheet({ title: "When", sub: why || "", body: `
      <div class="cv-seg" role="group" aria-label="When"><button type="button" data-wm="date" aria-pressed="${!feel}">Set the date</button><button type="button" data-wm="feel" aria-pressed="${feel}">Ask friends first</button></div>
      <div data-wp="date"${feel ? " hidden" : ""}>
        <div class="cv-quick" role="group" aria-label="Soon">${nextDays().map(([d, l]) => `<button type="button" class="cv-chip${W.date === d ? " on" : ""}" data-day="${d}">${esc(l)}</button>`).join("")}</div>
        <label class="cv-f">Date<input type="date" id="cvDate" value="${esc(W.date || "")}"></label>
        <label class="cv-f">Last day <small>Optional. For a weekend away or anything over a few days.</small><input type="date" id="cvEndDate" value="${esc(W.endDate && W.endDate > (W.date || "") ? W.endDate : "")}"></label></div>
      <div data-wp="feel"${feel ? "" : " hidden"}><p class="cv-hint">Not sure of the date, or if enough people will come? Friends say if they'd come and tap the dates that work. Nothing's booked until you call it.</p>
        ${opts.map((o, i) => `<label class="cv-f">Date option ${i + 1}${i ? " <small>Optional</small>" : ""}<input type="date" data-opt="${i}" value="${esc(o)}"></label>`).join("")}</div>
      <div class="cv-two"><label class="cv-f">Starts${timeSel("cvStart", W.startTime || "19:00")}</label><label class="cv-f">Ends${timeSel("cvEnd", W.endTime || "", "No end time")}</label></div>
      <p class="cv-err" id="cvWhenErr" role="alert"></p>`, foot: done() });
    let mode = feel ? "feel" : "date";
    Sh.$$("[data-wm]").forEach((b) => (b.onclick = () => { mode = b.dataset.wm; Sh.$$("[data-wm]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); Sh.$$("[data-wp]").forEach((p) => (p.hidden = p.dataset.wp !== mode)); Sh.$("#cvWhenErr").textContent = ""; }));
    Sh.$$("[data-day]").forEach((b) => (b.onclick = () => { Sh.$("#cvDate").value = b.dataset.day; Sh.$$("[data-day]").forEach((x) => x.classList.toggle("on", x === b)); }));
    Sh.$("[data-done]").onclick = () => { const s = Sh.$("#cvStart").value, en = Sh.$("#cvEnd").value, err = (m) => { Sh.$("#cvWhenErr").textContent = m; };
      if (en && en <= s && !(s >= "18:00" && en <= "04:00")) return err("The end time is before the start.");
      if (mode === "feel") { const O = [...new Set(Sh.$$("[data-opt]").map((x) => x.value).filter(Boolean))].sort(); if (!O.length) return err("Add at least one date for friends to pick from.");
        Object.assign(W, { stage: "interest", dateOptions: O, date: "", startTime: s, endTime: en }); }
      else { const d = Sh.$("#cvDate").value, d2 = Sh.$("#cvEndDate").value; if (!d) return err("Pick a date first."); if (d2 && d2 < d) return err("The last day is before the first."); Object.assign(W, { date: d, startTime: s, endTime: en }); if (d2 && d2 > d) W.endDate = d2; else delete W.endDate; if (W.stage === "interest") { W.stage = ""; W.dateOptions = []; } }
      Sh.close(); changed(true); pulse("#cvWhen", "when"); }; }

  function placeSheet() { const W = S.W;
    const Sh = sheet({ title: "Where", body: `
      <label class="cv-f">Place<input id="cvWhere" value="${esc(W.meetPoint || W.venueName || "")}" placeholder="My place, a park, a café" maxlength="120" autocomplete="off"></label>
      <label class="cv-f">Exact address <small>Only guests who are in see it.</small><input id="cvAddr" value="${esc(W.venueAddr || "")}" placeholder="12 Elm St, apt 4B" autocomplete="street-address" maxlength="160"></label>
      <label class="cv-f">City<input id="cvCity" value="${esc(W.city || "")}" autocomplete="address-level2" maxlength="60"></label>` + sw("cvPub", W.placePublic === true, "This is a public spot", "A park, a café or a bar. The map shows the exact pin. Leave it off for a home."), foot: done() });
    let pub = W.placePublic === true; wireSw(Sh, "cvPub", (v) => { pub = v; });
    Sh.$("[data-done]").onclick = () => { W.meetPoint = Sh.$("#cvWhere").value.trim(); W.venueAddr = Sh.$("#cvAddr").value.trim(); W.city = Sh.$("#cvCity").value.trim(); if (pub) W.placePublic = true; else delete W.placePublic; try { app("applyPlace")?.(W); } catch {} Sh.close(); changed(true); pulse("#cvPlace", "place"); }; }

  function cohostSheet() { const W = S.W; W.cohosts = Array.isArray(W.cohosts) ? W.cohosts : [];
    const list = () => W.cohosts.map((c, i) => `<div class="cv-li"><span>${esc(c.name || "@" + c.handle)}${c.name && c.handle ? ` <small>@${esc(c.handle)}</small>` : ""}</span><button type="button" class="cv-rm" data-cr="${i}" aria-label="Remove ${esc(c.name || c.handle)}">${I.x}</button></div>`).join("");
    const Sh = sheet({ title: "Co-hosts", sub: "Shown on the invite next to you. With a Pottery Lab handle, they can also message guests.", body: `<div id="cvCoList">${list()}</div>
      <div class="cv-add"><label class="vh" for="cvCo">Name or @handle</label><input id="cvCo" placeholder="Name or @handle" maxlength="60" autocomplete="off"><button type="button" class="cv-b" id="cvCoAdd">Add</button></div>`, foot: done() });
    const redraw = () => { Sh.$("#cvCoList").innerHTML = list(); Sh.$$("[data-cr]").forEach((b) => (b.onclick = () => { W.cohosts.splice(+b.dataset.cr, 1); redraw(); changed(); })); };
    const add = () => { const v = Sh.$("#cvCo").value.trim(); if (!v) return; const h = /^@[a-z0-9][a-z0-9-]{1,29}$/i.test(v) ? v.slice(1).toLowerCase() : ""; W.cohosts.push(h ? { handle: h, name: "" } : { handle: "", name: v.slice(0, 60) }); Sh.$("#cvCo").value = ""; redraw(); changed(); };
    Sh.$("#cvCoAdd").onclick = add; Sh.$("#cvCo").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }; redraw();
    Sh.$("[data-done]").onclick = () => { add(); Sh.close(); draw(); }; }

  function sectionSheet(i) { const W = S.W, L = SX().clean(W.sections), s = L[i] || { icon: "note", title: "", body: "" }, P = SX().PICK;
    const Sh = sheet({ title: i >= 0 ? "Edit section" : "New section", sub: i >= 0 ? "" : "Anything else guests should know.", body: `
      <div class="cv-icons" role="radiogroup" aria-label="Icon">${P.map((k) => `<button type="button" role="radio" aria-checked="${k === s.icon}" data-icon="${k}" aria-label="${k}">${SX().svg(k)}</button>`).join("")}</div>
      <label class="cv-f">Title<input id="cvSecT" value="${esc(s.title)}" placeholder="House rules, The plan, About the venue" maxlength="80"></label>
      <label class="cv-f">What it says<textarea id="cvSecB" rows="4" maxlength="1200" placeholder="Shoes off at the door. Dinner at 8, games after.">${esc(s.body)}</textarea></label><p class="cv-err" id="cvSecErr" role="alert"></p>`,
      foot: `${i >= 0 ? `<button type="button" class="cv-b" id="cvSecDel">Delete</button>` : `<button type="button" class="cv-b" data-x>Cancel</button>`}<button type="button" class="cv-b pri" id="cvSecOk">${i >= 0 ? "Save" : "Add section"}</button>` });
    let icon = s.icon; Sh.$$("[data-icon]").forEach((b) => (b.onclick = () => { icon = b.dataset.icon; Sh.$$("[data-icon]").forEach((x) => x.setAttribute("aria-checked", String(x === b))); }));
    Sh.$("#cvSecOk").onclick = () => { const t = Sh.$("#cvSecT").value.trim(), bd = Sh.$("#cvSecB").value.trim(); if (!t && !bd) { Sh.$("#cvSecErr").textContent = "Give it a title or a few words."; return; }
      const n = { icon, title: t, body: bd }; if (i >= 0) L[i] = n; else L.push(n); W.sections = L; Sh.close(); changed(true); const nb = q(`[data-sec="${i >= 0 ? i : L.length - 1}"]`, S.el); if (i < 0) nb?.scrollIntoView({ block: "center", behavior: "smooth" }); pulse(nb, "sections"); };
    if (Sh.$("#cvSecDel")) Sh.$("#cvSecDel").onclick = () => { L.splice(i, 1); W.sections = L; Sh.close(); changed(true); }; }

  function lookSheet() { const W = S.W, LK = root.EncoreLooks, SWS = LK?.SWATCHES || [], cur = (W.look?.palette || [])[0] || "";
    const Sh = sheet({ title: "Look", sub: "The page colours. Your title style stays as it is.", body: `<div class="cv-looks" role="radiogroup" aria-label="Colours">
      <button type="button" role="radio" aria-checked="${!cur}" data-pal=""><i style="background:#FAF6F0"><b style="background:#1F1A17"></b></i><span>House</span></button>
      ${SWS.map((s, k) => `<button type="button" role="radio" aria-checked="${cur === s[0]}" data-pal="${k}"><i style="background:${s[0]}"><b style="background:${s[1]}"></b></i><span>${esc(s[3])}</span></button>`).join("")}</div>`, foot: done() });
    Sh.$("[data-done]").onclick = Sh.close;
    Sh.$$("[data-pal]").forEach((b) => (b.onclick = () => { const L = { ...(W.look || {}) }; if (b.dataset.pal === "") delete L.palette; else L.palette = SWS[+b.dataset.pal].slice(0, 3); delete L.vibe; W.look = L; W.theme = ""; Sh.$$("[data-pal]").forEach((x) => x.setAttribute("aria-checked", String(x === b))); changed(); dress(); })); }

  function effectSheet() { const W = S.W, cur = effectOf(W);
    const Sh = sheet({ title: "Effect", sub: "Something quiet in the background. Off unless you pick one. It holds still for anyone who prefers less motion.", body: `<div class="cv-opts" role="radiogroup" aria-label="Effect">${EFFECTS.map(([k, l, s]) => `<button type="button" role="radio" aria-checked="${k === cur}" data-fx="${k}"><b>${esc(l)}</b><small>${esc(s)}</small></button>`).join("")}</div>`, foot: done() });
    Sh.$("[data-done]").onclick = Sh.close;
    Sh.$$("[data-fx]").forEach((b) => (b.onclick = () => { const v = EFFECTS.find((x) => x[0] === b.dataset.fx)[3]; W.look = { ...(W.look || {}), effect: v }; if (v === "none") delete W.look.effect; W.effect = "none"; Sh.$$("[data-fx]").forEach((x) => x.setAttribute("aria-checked", String(x === b))); changed(); dress(); })); }

  // ---------- quick actions: the settings that used to be long sections, each in its own sheet ----------
  function quick(k) { const W = S.W, refresh = () => { const p = q(".cv-pills", S.el); if (p) p.innerHTML = pills(W); };
    if (k === "questions") { const Sh = sheet({ title: "Questions for guests", sub: "Asked when they reply. Answers show on your guest list.", wide: true, body: `<div id="cvQb"></div>`, foot: done(), onClose: () => { refresh(); draw(); } });
      Sh.$("[data-done]").onclick = Sh.close; const QB = root.Questions;
      if (QB?.builder) { try { QB.builder(Sh.$("#cvQb"), W, () => changed()); } catch (e) { console.warn(e); } }
      else { Sh.$("#cvQb").innerHTML = `<label class="cv-f">A question<input id="cvAsk" value="${esc(W.askQ || "")}" placeholder="Anything you don't eat?" maxlength="120"></label>`; Sh.$("#cvAsk").oninput = (e) => { W.askQ = e.target.value; changed(); }; } return; }
    if (k === "reminders") { const Sh = sheet({ title: "Reminders", body: sw("cvRem", W.autoRemind !== false, "Remind guests the day before", "Everyone who's in gets a short note with the time and place.") + `<p class="cv-hint">You can also message guests any time from your event.</p>`, foot: done(), onClose: refresh });
      Sh.$("[data-done]").onclick = Sh.close; wireSw(Sh, "cvRem", (v) => { W.autoRemind = v; changed(); }); return; }
    if (k === "approval") { const Sh = sheet({ title: "Require approval", body: sw("cvAppr", !!W.approvalRequired, "I let each guest in", "Guests ask to join. You see who they are and say yes.") + sw("cvHideG", !W.hideGuests, "Show who's going", "Guests who are in see each other's first names."), foot: done(), onClose: () => draw() });
      Sh.$("[data-done]").onclick = Sh.close; wireSw(Sh, "cvAppr", (v) => { W.approvalRequired = v; changed(); }); wireSw(Sh, "cvHideG", (v) => { W.hideGuests = !v; changed(); }); return; }
    if (k === "more") return moreSheet(); }
  const rows = (R) => R.map(([k, t, s]) => `<button type="button" class="cv-rowbtn" data-row="${k}"><span><b>${esc(t)}</b><small>${esc(s)}</small></span>${I.chev}</button>`).join("");
  const priceLine = (W) => (W.price && W.price !== "chip" ? String(W.price) : "Free");
  function moreSheet() { const W = S.W, saved = !!S.orig?.id;
    const R = [["price", "Price and tickets", priceLine(W) + (W.ticketUrl ? " · payment link" : "")], ["spots", "Spots and waitlist", +W.headcount ? `${+W.headcount} spots${W.autoWait !== false ? ", waitlist when full" : ""}` : "No limit"], ["plus", "Plus-ones", +W.plusOnes ? `Up to ${+W.plusOnes} each` : "None"], ["repeat", "Repeat", ({ weekly: "Every week", biweekly: "Every two weeks", monthly: "Every month" })[W.repeat] || "Just once"],
      ["drop", "Orders for pickup", "Selling something ahead? Make it a drop."], ...(saved ? [["tools", "More tools", "Check-in, tables, slots, texting the invite, the guest list file."]] : [])];
    const Sh = sheet({ title: "More", body: `<div class="cv-rowlist">${rows(R)}</div>${saved ? "" : `<p class="cv-hint">Check-in, tables and the other tools open after you save.</p>`}` });
    Sh.$$("[data-row]").forEach((b) => (b.onclick = () => { Sh.close(); setting(b.dataset.row); })); }
  function setting(k) { const W = S.W;
    if (k === "price") { const Sh = sheet({ title: "Price and tickets", body: `<div class="cv-two"><label class="cv-f">Price a person<input id="cvPrice" value="${esc(W.price && W.price !== "chip" ? W.price : "")}" placeholder="Free" inputmode="decimal" maxlength="20"></label><label class="cv-f">Payment link<input id="cvPay" value="${esc(W.ticketUrl || "")}" placeholder="venmo.com/you" inputmode="url" autocapitalize="off"></label></div><p class="cv-hint">Guests see the price on the invite and pay you with the link.</p>`, foot: done() });
      Sh.$("[data-done]").onclick = () => { const p = Sh.$("#cvPrice").value.trim(), u = Sh.$("#cvPay").value.trim(); W.price = p && !/^(free|0|\$0)$/i.test(p) ? p : ""; W.free = !W.price; W.ticketUrl = u ? (/^https?:\/\//i.test(u) ? u : "https://" + u) : ""; Sh.close(); changed(); }; return; }
    if (k === "spots") { const Sh = sheet({ title: "Spots and waitlist", body: `<label class="cv-f">How many spots<input id="cvSpots" type="number" min="1" inputmode="numeric" value="${esc(+W.headcount || "")}" placeholder="No limit"></label>${sw("cvWait", W.autoWait !== false, "Start a waitlist when it's full", "If someone drops out, the next person gets the spot.")}`, foot: done() });
      let wait = W.autoWait !== false; wireSw(Sh, "cvWait", (v) => (wait = v)); Sh.$("[data-done]").onclick = () => { const n = Math.round(+Sh.$("#cvSpots").value); W.headcount = n > 0 ? n : 0; W.autoWait = wait; Sh.close(); changed(); }; return; }
    if (k === "plus") { const Sh = sheet({ title: "Plus-ones", body: `<label class="cv-f">Each guest can bring<select id="cvPlus">${[0, 1, 2, 3].map((n) => `<option value="${n}"${(+W.plusOnes || 0) === n ? " selected" : ""}>${n ? (n === 1 ? "1 person" : n + " people") : "Nobody"}</option>`).join("")}</select></label>`, foot: done() });
      Sh.$("[data-done]").onclick = () => { W.plusOnes = +Sh.$("#cvPlus").value; Sh.close(); changed(); }; return; }
    if (k === "repeat") { const Sh = sheet({ title: "Repeat", sub: "Pottery Lab drafts the next one for you to check. Nothing goes out on its own.", body: `<div class="cv-opts" role="radiogroup" aria-label="Repeat">${[["", "Just once"], ["weekly", "Every week"], ["biweekly", "Every two weeks"], ["monthly", "Every month"]].map(([v, l]) => `<button type="button" role="radio" aria-checked="${(W.repeat || "") === v}" data-rep="${v}"><b>${l}</b></button>`).join("")}</div>`, foot: done() });
      Sh.$$("[data-rep]").forEach((b) => (b.onclick = () => { W.repeat = b.dataset.rep; Sh.$$("[data-rep]").forEach((x) => x.setAttribute("aria-checked", String(x === b))); changed(); })); Sh.$("[data-done]").onclick = Sh.close; return; }
    if (k === "drop") { const D = root.EncoreDrop; if (!D?.setup) return say("That isn't ready yet. Try again in a moment."); leave(() => D.setup({ onDone: () => location.reload() })); return; }
    if (k === "plan") { const id = S.orig?.id || W.id; if (!S.orig?.id || !id) return say("Save the event first, then lay out the plan."); leave(() => { location.href = `/plans/${encodeURIComponent(id)}?edit=1`; }); return; }
    if (k === "tools") { const H = root.HostEvent; leave(() => H?.openTools?.(getDraft())); return; }
    if (k === "classic") { leave(() => { root.__hvClassic = true; const h = document.getElementById("hv"); if (h) h.hidden = true; try { root.HostEvent?.useDraft?.(getDraft()); app("renderStep")?.(); } catch {} }); return; }
    if (k === "questions" || k === "reminders" || k === "approval") return quick(k); }
  function settingsSheet() { const W = S.W, saved = !!S.orig?.id, n = (W.questions || []).length;
    const R = [["questions", "Questions for guests", n ? `${n} question${n > 1 ? "s" : ""}` : "None yet"], ["reminders", "Reminders", W.autoRemind !== false ? "The day before" : "Off"], ["approval", "Require approval", W.approvalRequired ? "You let each guest in" : "Anyone with the link can say yes"],
      ["price", "Price and tickets", priceLine(W)], ["spots", "Spots and waitlist", +W.headcount ? `${+W.headcount} spots` : "No limit"], ["plus", "Plus-ones", +W.plusOnes ? `Up to ${+W.plusOnes} each` : "None"], ["repeat", "Repeat", ({ weekly: "Every week", biweekly: "Every two weeks", monthly: "Every month" })[W.repeat] || "Just once"],
      ["plan", "The plan, day by day", (W.itinerary || []).length ? `${W.itinerary.length} ${W.itinerary.length === 1 ? "item" : "items"}` : saved ? "An itinerary or agenda guests can follow" : "Save first, then lay out the days"],
      ...(saved ? [["tools", "More tools", "Check-in, tables, slots, texting the invite"], ["classic", "Every setting", "The full planner, with every option."]] : [])];
    const V = visKey(W, S.club); const Sh = sheet({ title: "Settings", body: `<label class="cv-f">Who can find this event?<select id="cvVis2">${visList(CLUB?.on).map(([k, l]) => `<option value="${k}"${k === V ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label><div class="cv-rowlist">${rows(R)}</div>`, onClose: () => draw() });
    Sh.$("#cvVis2").onchange = (e) => setVis(e.target.value);
    Sh.$$("[data-row]").forEach((b) => (b.onclick = () => { Sh.close(); setting(b.dataset.row); })); }

  // who can find it; "Fan club only" is kept beside the event and sent to the fan club on save
  function setVis(k) { S.club = k === "club" ? "members" : S.club === "members" ? "everyone" : S.club; visApply(S.W, k); changed(); }

  // ---------- leaving: close, save ----------
  // a tool that lives outside the canvas: keep the changes first (a saved event saves; a new one stays on this device)
  async function leave(fn) { if (S.orig?.id && S.dirty) { const ok = await commit(false); if (!ok) return; } close(); fn(); }
  function tryClose() { if (!S.dirty) { ls.del(S.key); return close(); }
    const Sh = sheet({ title: S.isNew && !S.orig ? "Keep this for later?" : "Leave without saving?", sub: S.isNew && !S.orig ? "It stays on this device. Tap New to pick it up again." : "Your changes stay on this device until you save or discard them.",
      body: "", foot: `<button type="button" class="cv-b" id="cvDiscard">Discard</button><button type="button" class="cv-b pri" id="cvKeep">Keep for later</button>` });
    Sh.$("#cvDiscard").onclick = () => { ls.del(S.key); Sh.close(); close(); };
    Sh.$("#cvKeep").onclick = () => { ls.set(S.key, { at: Date.now(), base: S.base, d: S.W, club: S.club }); Sh.close(); close(); }; }
  // write the canvas into the app's event and save it. publish: share it with the chosen visibility
  async function commit(publish) { const W = S.W, save = app("saveEvent"); if (!save) { say("Saving isn't ready yet. Try again in a moment."); return false; }
    W.name = W.pubTitle = String(W.pubTitle || W.name || "").trim(); W.sections = SX().clean(W.sections);
    if (publish) visApply(W, visKey(W, S.club), { publish: true });
    let d; if (S.orig) { Object.assign(S.orig, clone(W)); d = S.orig; if (getDraft() !== d) setDraft(d); } else { d = clone(W); setDraft(d); }
    const ok = await save(true); if (ok === false) { if (publish && S.isNew) { d.published = false; d.discoverable = false; W.published = false; W.discoverable = false; } return false; }
    // fan club only (server/fanclub.js): set after the event has an id, and only when it changed
    if (d.id && S.club !== S.clubWas && (S.club === "members" || S.clubWas === "members")) { try { const r = await fetch("/api/host/club/events/" + encodeURIComponent(d.id), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visibility: S.club === "members" ? "members" : "everyone" }) }); if (r.ok) { S.clubWas = S.club; const x = CLUB?.events?.find((e) => e.id === d.id); if (x) x.visibility = S.club; else CLUB?.events?.push({ id: d.id, visibility: S.club }); } else say("Saved, but the fan club setting didn't stick. Try again from Settings."); } catch {} }
    S.orig = d; ls.del(S.key); ls.del(KEY_NEW); S.key = keyOf(d); S.base = d.updatedAt || null; S.dirty = false; return true; }
  async function save() { const W = S.W, b = q("[data-cv=save]", S.el), miss = missing(W);
    if (miss === "title") { const t = q("#cvTitle", S.el); q("#cvTitleErr", S.el).textContent = "Add a title first."; t.scrollIntoView({ block: "center", behavior: "smooth" }); t.focus({ preventScroll: true }); return; }
    if (miss === "date") return whenSheet("Pick a date so guests know when.");
    const bad = addonFix(W); if (bad.length) { draw(); const el = q(bad[0] === "playlist" ? '[data-af="playlist"]' : '[data-lf="url"]', S.el); say(bad[0] === "playlist" ? "That playlist link doesn't look right." : "That link doesn't look right."); el?.focus(); return; }
    const first = S.isNew; b.disabled = true; b.textContent = "Saving…";
    const ok = await commit(first); b.disabled = false; b.textContent = "Save";
    if (!ok) { say(first ? "Couldn't share it. Try again." : "Couldn't save. Try again."); return; }
    const d = getDraft(); close();
    try { if (location.hash !== "#studio") location.hash = "#studio"; app("renderStep")?.(); } catch (e) { console.warn(e); }
    // the first save shares it, then the app's own share entry: the share kit (public/sharekit.js) when it's there,
    // else the event page's "Share invite" sheet, else the older share sheet
    if (first) { try { const K = root.ShareKit, H = root.HostEvent; if (K?.open) K.open(d); else if (H?.openShare) H.openShare(d, true); else app("shareSheet")?.(d); } catch (e) { console.warn(e); } }
    else say((d.published || d.discoverable) ? "Saved. Guests see the change right away." : "Saved."); }

  // ---------- styles ----------
  function css() { if (document.getElementById("cvCss")) return; const s = document.createElement("style"); s.id = "cvCss"; s.textContent = CSS; document.head.appendChild(s); }
  const CSS = `
#cv,.cv-sh-bg{--cv-bg:var(--pl-page,#F4F0E8);--cv-ink:var(--pl-ink,#1D1B18);--cv-soft:var(--pl-soft,#5D564E);--cv-line:var(--pl-line,#E2DCD1);--cv-line2:var(--pl-line-strong,#CFC6B8);--cv-card:var(--pl-surface,#FBF9F5);--cv-field:#FFFFFF;
  --cv-pri:var(--pl-ink,#1D1B18);--cv-on-pri:#FFFFFF;--cv-acc:var(--pl-accent,#9A4128);--cv-acc-soft:var(--pl-accent-soft,#F1E1D8);--cv-err:var(--pl-danger,#A3321E);--cv-sans:var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)}
#cv{--cv-dock-h:60px;--cv-gap:16px;position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;background:var(--cv-bg);color:var(--cv-ink);font:400 16px/1.5 var(--cv-sans);-webkit-font-smoothing:antialiased}
body.cv-open{overflow:hidden}body.cv-open #encoreHelp,body.cv-open .es-tabs,body.cv-open #pipFab{visibility:hidden}
#cv .vh,.cv-sh .vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
#cv button,.cv-sh button{font-family:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;box-shadow:none;text-transform:none;letter-spacing:normal}
#cv :is(button,.cv-ic)>svg,.cv-sh button>svg{width:18px;height:18px;flex:none}
#cv :focus-visible,.cv-sh :focus-visible{outline:2px solid var(--cv-ink)!important;outline-offset:2px}
/* the top bar: close, Edit | Guest view, Save */
#cv .cv-top{display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top)) 16px 8px;background:var(--cv-bg)}
#cv .cv-x,.cv-sh .cv-x{width:44px;height:44px;border-radius:999px!important;border:1px solid var(--cv-line2)!important;background:var(--cv-card)!important;display:grid;place-items:center;padding:0;margin:0}
#cv .cv-mode{justify-self:center;display:grid;grid-template-columns:auto auto;padding:3px;border-radius:999px;background:var(--pl-raised,#ECE6DB);min-width:0}
#cv .cv-mode button{min-height:38px;padding:0 14px;border:0!important;border-radius:999px!important;background:transparent!important;font-size:15px;font-weight:600;color:var(--cv-soft)!important;white-space:nowrap}
#cv .cv-mode button[aria-pressed=true]{background:var(--cv-card)!important;color:var(--cv-ink)!important;box-shadow:0 1px 3px rgba(29,27,24,.14)}
#cv .cv-save{min-height:44px;padding:0 20px;border-radius:999px!important;border:0!important;background:var(--cv-pri)!important;color:var(--cv-on-pri)!important;font-weight:600;font-size:16px}#cv .cv-save:disabled{opacity:.6}
#cv .cv-state{margin:0;padding:0 16px 8px;text-align:center;font-size:14px;color:var(--cv-soft);border-bottom:1px solid var(--cv-line)}
/* the editor and the live guest preview */
#cv .cv-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr)}
#cv .cv-scroll{overflow-y:auto;overscroll-behavior:contain;position:relative;isolation:isolate;-webkit-overflow-scrolling:touch;min-height:0}
#cv .cv-scroll.lk-on.lk-page{--cv-ink:var(--lk-ink);--cv-soft:var(--lk-soft);--cv-line:var(--lk-line);--cv-line2:var(--lk-line2);--cv-card:var(--lk-raised);--cv-field:var(--lk-field);color:var(--cv-ink)}
#cv .cv-guest{display:none;min-height:0;flex-direction:column;background:var(--pl-raised,#ECE6DB)}
#cv .cv-glab{display:flex;align-items:center;gap:8px;justify-content:center;margin:0;padding:8px 16px;font-size:14px;font-weight:500;color:var(--cv-ink)}
#cv .cv-phone{flex:1;min-height:0;display:flex}#cv .cv-phone iframe{flex:1;width:100%;height:100%;border:0;background:#fff;display:block}
#cv .cv-left{display:flex;flex-direction:column;min-height:0;min-width:0}#cv .cv-left>.cv-scroll{flex:1}
#cv.guest .cv-left{display:none}#cv .cv-scroll{box-shadow:inset 0 -1px 0 var(--cv-line)}#cv.guest .cv-guest{display:flex}
@media (min-width:1024px){#cv .cv-body{grid-template-columns:minmax(0,1fr) 470px}#cv .cv-guest{display:flex;border-left:1px solid var(--cv-line);padding:0 0 20px;align-items:center}
  #cv .cv-phone{flex:1;width:390px;max-height:844px;border-radius:36px;overflow:hidden;border:8px solid var(--pl-ink,#1D1B18);box-shadow:0 18px 40px -18px rgba(29,27,24,.45)}
  #cv.guest .cv-body{grid-template-columns:minmax(0,1fr)}#cv.guest .cv-guest{border-left:0}}
/* the page */
#cv .cv-page{max-width:620px;margin:0 auto;padding:16px 16px 28px;display:grid;gap:14px}
#cv .cv-tag{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;margin:0;font-size:14px;font-weight:500;color:var(--cv-soft)}#cv .cv-tag .cv-text-btn{margin-left:auto}
#cv .cv-dot{width:8px;height:8px;border-radius:999px;background:var(--cv-line2);flex:none}#cv .cv-dot.g{background:var(--pl-success,#3D6A4C)}
#cv .cv-note{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0;padding:10px 14px;border-radius:14px;background:var(--cv-card);border:1px solid var(--cv-line);font-size:15px}
/* anything editable: a dashed outline on hover or focus, a quiet pulse when it changes */
#cv .cv-ed{border-radius:14px;outline:1.5px dashed transparent;outline-offset:4px;transition:outline-color .15s}
#cv .cv-ed:hover,#cv .cv-ed:focus-within,#cv button.cv-ed:focus-visible{outline:1.5px dashed var(--cv-line2)!important}
@keyframes cvPulse{0%{box-shadow:0 0 0 0 rgba(154,65,40,0)}25%{box-shadow:0 0 0 5px rgba(154,65,40,.28)}100%{box-shadow:0 0 0 0 rgba(154,65,40,0)}}
#cv .cv-pulse{animation:cvPulse 1.1s ease-out}
#cv textarea.cv-title{display:block;width:100%;box-sizing:border-box;resize:none;overflow:hidden;border:0!important;background:transparent!important;border-radius:0!important;box-shadow:none!important;color:inherit;padding:2px 0!important;margin:0;outline:none;min-height:0;
  font-size:calc(38px * var(--tk,1))!important;line-height:1.1!important;min-height:0!important}
#cv .cv-title::placeholder{color:var(--cv-soft);opacity:.7}
#cv .cv-err{margin:-8px 0 0;color:var(--cv-err);font-size:15px;font-weight:500}#cv .cv-err:empty{display:none}
#cv .cv-styles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
#cv .cv-styles button{min-height:44px;padding:0 6px;border-radius:12px!important;border:1px solid var(--cv-line2)!important;background:var(--cv-card)!important;font-size:17px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cv .cv-styles button[aria-checked=true]{border-color:var(--cv-ink)!important;box-shadow:inset 0 0 0 1px var(--cv-ink)}
#cv .cv-cover{position:relative;aspect-ratio:16/9;border-radius:16px;overflow:hidden;background:var(--cv-card);border:1px solid var(--cv-line);margin-top:2px}
#cv .cv-cover>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
#cv .cv-pen{position:absolute;right:12px;top:12px;z-index:2;display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 16px 0 14px;border-radius:999px!important;border:0!important;background:rgba(255,255,255,.96)!important;color:#1D1B18!important;font-size:15px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.18)}
#cv .cv-when{display:grid;gap:2px;text-align:left;width:100%;padding:14px 16px!important;border-radius:16px!important;border:1px solid var(--cv-line)!important;background:var(--cv-card)!important;margin:0}
#cv .cv-when b{font-size:21px;font-weight:600;letter-spacing:-.01em;line-height:1.25}#cv .cv-when span{color:var(--cv-soft);font-size:16px}#cv .cv-when small{font-size:14px;font-weight:600;color:var(--pl-accent-text,#8E3B24)}#cv .cv-when.empty b{color:var(--cv-ink)}
#cv .cv-rows{display:grid;border:1px solid var(--cv-line);border-radius:16px;background:var(--cv-card)}
#cv .cv-row{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:12px;align-items:center;width:100%;min-height:62px;padding:10px 14px!important;border:0!important;background:none!important;text-align:left;margin:0;border-radius:16px!important}
#cv .cv-row+.cv-row{border-top:1px solid var(--cv-line)!important;border-radius:0 0 16px 16px!important}#cv .cv-rt{display:grid;min-width:0}#cv .cv-rt small{color:var(--cv-soft);font-size:14px}#cv .cv-rt b{font-weight:600;font-size:16px;overflow-wrap:anywhere}#cv .cv-rt em{font-style:normal;color:var(--cv-soft);font-size:15px}
#cv .cv-with{font-weight:400;color:var(--cv-soft)}
#cv .cv-av{width:36px;height:36px;border-radius:999px;background:var(--c);color:#1D1B18;display:grid;place-items:center;font-weight:600;overflow:hidden}#cv .cv-av img{width:100%;height:100%;object-fit:cover}
#cv .cv-ic{width:36px;height:36px;border-radius:999px;border:1px solid var(--cv-line2);display:grid;place-items:center}
#cv .cv-mini,.cv-sh .cv-mini{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 14px;border-radius:999px!important;border:1px solid var(--cv-line2)!important;background:var(--cv-card)!important;font-size:15px;font-weight:600;white-space:nowrap;margin:0}#cv .cv-mini svg{width:16px;height:16px}
#cv textarea.cv-desc{display:block;width:100%;box-sizing:border-box;resize:none;overflow:hidden;border:0!important;border-bottom:1px solid var(--cv-line)!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;color:inherit;font:inherit;font-size:17px;line-height:1.6;padding:6px 0 12px!important;outline:none;min-height:84px}
#cv .cv-desc::placeholder,#cv .cv-blk :is(input,textarea)::placeholder{color:var(--cv-soft);opacity:.85}
#cv .cv-blocks{display:grid;gap:10px}#cv .cv-blocks:empty{display:none}
#cv .cv-blk{display:grid;gap:8px;padding:12px 14px 14px;border-radius:16px;border:1px solid var(--cv-line);background:var(--cv-card)}#cv .cv-blk.new{animation:cvIn .35s ease both}
@keyframes cvIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
html body #cv :is(h2,h3),html body .cv-sh-bg .cv-sh :is(h2,h3){font-family:var(--cv-sans)!important;letter-spacing:-.005em!important}
#cv .cv-blk header{display:grid;grid-template-columns:20px minmax(0,1fr) 40px;gap:10px;align-items:center}#cv .cv-blk h3{margin:0;font:600 17px/1.3 var(--cv-sans)}#cv .cv-blk p{margin:0;line-height:1.55;font-size:16px;overflow-wrap:anywhere}
#cv .cv-blk .evs-ic{width:20px;height:20px}
#cv .cv-blk :is(input,textarea),.cv-sh :is(input,textarea,select){font-weight:400!important;width:100%;box-sizing:border-box;min-height:46px;padding:10px 12px!important;border-radius:12px!important;border:1px solid var(--cv-line2)!important;background:var(--cv-field)!important;color:var(--cv-ink);font:inherit;font-size:16px;resize:none;box-shadow:none!important}
#cv .cv-blk textarea{overflow:hidden;min-height:46px}
#cv .cv-rm,.cv-sh .cv-rm{width:40px;height:40px;border-radius:999px!important;border:0!important;background:transparent!important;display:grid;place-items:center;color:var(--cv-soft)!important;padding:0;margin:0}
#cv .cv-two,.cv-sh .cv-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:8px}
#cv .cv-text-btn,.cv-sh .cv-text-btn{display:inline-flex;align-items:center;gap:6px;justify-self:start;min-height:40px;padding:0!important;border:0!important;background:none!important;font-size:15px;font-weight:600;text-decoration:underline;text-underline-offset:3px;color:var(--cv-ink)!important;margin:0}
#cv .cv-chips{display:flex;gap:8px;overflow-x:auto;margin:0 -16px;padding:2px 16px 6px;scrollbar-width:none;scroll-snap-type:x proximity}#cv .cv-chips::-webkit-scrollbar{display:none}
#cv .cv-chip,.cv-sh .cv-chip{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 16px;border-radius:999px!important;border:1px dashed var(--cv-line2)!important;background:transparent!important;font-size:16px;font-weight:500;white-space:nowrap;scroll-snap-align:start;margin:0}#cv .cv-chip svg{width:15px;height:15px}
.cv-sh .cv-chip.on{border-style:solid!important;border-color:var(--cv-ink)!important;background:var(--cv-ink)!important;color:var(--cv-bg)!important}
#cv .cv-moresay{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0;font-size:16px;color:var(--cv-ink)}
#cv .cv-reply{display:grid;gap:10px;justify-items:center;padding:16px 0 4px}#cv .cv-reply p{margin:0;font-size:18px;font-weight:600}#cv .cv-reply div{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
#cv .cv-reply span{min-height:46px;min-width:96px;padding:0 18px;border-radius:999px;border:1px solid var(--cv-line2);display:inline-grid;place-items:center;font-weight:600;background:var(--cv-card)}
#cv .cv-reply span:first-child{background:var(--lk-btn,var(--cv-acc));color:var(--lk-on-btn,#fff);border-color:transparent}
#cv .cv-host{display:grid;gap:18px;margin-top:10px;padding:18px 16px;border-radius:18px;border:1px dashed var(--cv-line2);background:var(--pl-sand-soft,#F0E9DA);color:var(--pl-ink,#1D1B18);--cv-soft:var(--pl-soft,#5D564E)}
#cv .cv-field,#cv .cv-f,.cv-sh .cv-f{display:grid;gap:6px;font-weight:600;font-size:16px}#cv .cv-field small,.cv-sh .cv-f small{font-weight:400;color:var(--cv-soft);font-size:14px}
#cv .cv-field select{width:100%;min-height:48px;padding:0 12px!important;border-radius:12px!important;border:1px solid var(--cv-line2)!important;background:#fff!important;color:var(--cv-ink);font:inherit;font-size:16px;font-weight:500}
#cv .cv-uf{display:grid;grid-template-columns:96px minmax(0,1fr);border-radius:14px;overflow:hidden;background:#fff;border:1px solid var(--cv-line2);font-weight:400}
#cv .cv-uf img{width:96px;height:100%;min-height:84px;object-fit:cover;background:var(--pl-raised,#ECE6DB)}#cv .cv-uf div{display:grid;align-content:center;gap:2px;padding:10px 12px;min-width:0}
#cv .cv-uf b{font-size:16px;font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#cv .cv-uf span{font-size:14px;color:var(--cv-soft);line-height:1.35}#cv .cv-uf small{font-size:13px;color:var(--cv-soft)}
#cv .cv-fromline{display:block;margin:-2px 0 10px;padding:10px 14px;min-height:44px;border:1.5px dashed var(--cv-line2)!important;border-radius:6px!important;background:var(--cv-card)!important;color:inherit;font:600 15px/1.35 var(--cv-sans);text-align:left;cursor:pointer;width:100%}#cv .cv-fromline[hidden]{display:none}
#cv .cv-qa{display:grid;gap:10px}#cv .cv-qa-h{font-weight:600;font-size:16px}#cv .cv-pills{display:flex;flex-wrap:wrap;gap:8px}
#cv .cv-pill{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 16px;border-radius:999px!important;border:1px solid var(--cv-line2)!important;background:#fff!important;font-size:15px;font-weight:600;margin:0}#cv .cv-pill svg{width:16px;height:16px}
#cv .cv-pill.on{border-color:var(--cv-ink)!important;box-shadow:inset 0 0 0 1px var(--cv-ink)}
/* the dock floats over the page's bottom padding, never over content */
#cv .cv-dock{position:relative;flex:none;align-self:center;margin:8px auto calc(12px + env(safe-area-inset-bottom));z-index:3;display:grid;grid-template-columns:repeat(3,78px);height:var(--cv-dock-h);padding:0 6px;border-radius:999px;background:var(--pl-ink,#1D1B18);color:#F4F0E8;box-shadow:0 12px 32px -10px rgba(0,0,0,.45)}
#cv .cv-dock button{display:grid;place-items:center;align-content:center;gap:2px;border:0!important;background:none!important;color:#F4F0E8!important;font-size:13px;font-weight:600;border-radius:999px!important;margin:0;padding:0}#cv .cv-dock button:focus-visible{outline:2px solid #F4F0E8!important;outline-offset:-4px}
/* sheets */
.cv-sh-bg{position:fixed;inset:0;z-index:9500;background:rgba(29,27,24,.36);display:flex;align-items:flex-end;justify-content:center;animation:cvFade .16s ease both}
@keyframes cvFade{from{opacity:0}to{opacity:1}}
.cv-sh{width:100%;max-width:560px;max-height:88vh;display:flex;flex-direction:column;background:var(--cv-card);color:var(--cv-ink);border-radius:22px 22px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.2);font:400 16px/1.5 var(--cv-sans);animation:cvUp .22s cubic-bezier(.2,.9,.3,1) both}
@keyframes cvUp{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){.cv-sh,.cv-sh-bg,#cv .cv-blk.new,#cv .cv-pulse{animation:none}#cv .cv-pulse{outline:2px solid rgba(154,65,40,.45)!important}}
.cv-sh>header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 16px 6px}.cv-sh h2{margin:0;font:600 20px/1.25 var(--cv-sans);letter-spacing:-.01em}.cv-sh header p{margin:4px 0 0;color:var(--cv-soft);font-size:15px}
.cv-sh-body{padding:10px 16px 16px;overflow-y:auto;display:grid;gap:14px}.cv-sh-body:empty{display:none}.cv-sh-body [hidden]{display:none!important}.cv-sh-body>div[data-wp]{display:grid;gap:12px}
.cv-sh footer{display:flex;gap:10px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--cv-line)}.cv-sh footer .cv-b{flex:1}
.cv-sh .cv-b{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 18px;border-radius:999px!important;border:1px solid var(--cv-line2)!important;background:#fff!important;font-weight:600;font-size:16px;cursor:pointer;margin:0}
.cv-sh .cv-b.pri{background:var(--cv-pri)!important;color:var(--cv-on-pri)!important;border-color:transparent!important}
.cv-sh .cv-sect{margin:4px 0 -6px;font-size:14px;font-weight:600;color:var(--cv-soft)}.cv-sh .cv-hint{margin:0;color:var(--cv-soft);font-size:15px}
.cv-sh .cv-seg{display:grid;grid-template-columns:1fr 1fr;padding:3px;border-radius:999px;background:var(--pl-raised,#ECE6DB)}
.cv-sh .cv-seg button{min-height:42px;border:0!important;border-radius:999px!important;background:transparent!important;font-size:15px;font-weight:600;color:var(--cv-soft)!important;margin:0}
.cv-sh .cv-seg button[aria-pressed=true]{background:#fff!important;color:var(--cv-ink)!important;box-shadow:0 1px 3px rgba(29,27,24,.14)}
.cv-sh .cv-quick{display:flex;gap:8px;flex-wrap:wrap}
.cv-sh .cv-sw{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:4px 0}.cv-sh .cv-sw b{display:block;font-weight:600}.cv-sh .cv-sw small{display:block;color:var(--cv-soft);font-size:15px}
.cv-sh .cv-sw [role=switch]{width:52px;height:32px;border-radius:999px!important;border:0!important;background:var(--cv-line2)!important;position:relative;padding:0;margin:0}.cv-sh .cv-sw [role=switch] i{position:absolute;top:3px;left:3px;width:26px;height:26px;border-radius:999px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .18s}
.cv-sh .cv-sw [role=switch][aria-checked=true]{background:var(--cv-pri)!important}.cv-sh .cv-sw [role=switch][aria-checked=true] i{transform:translateX(20px)}
.cv-sh .cv-opts{display:grid;gap:8px}.cv-sh .cv-opts button{display:grid;gap:2px;text-align:left;padding:12px 14px;border-radius:14px!important;border:1px solid var(--cv-line2)!important;background:#fff!important;margin:0}.cv-sh .cv-opts small{color:var(--cv-soft);font-size:15px}
.cv-sh .cv-opts button[aria-checked=true]{border-color:var(--cv-ink)!important;box-shadow:inset 0 0 0 1px var(--cv-ink)}
.cv-sh .cv-looks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.cv-sh .cv-looks button{display:grid;justify-items:center;gap:6px;padding:12px 6px;border-radius:14px!important;border:1px solid var(--cv-line)!important;background:#fff!important;font-size:15px;margin:0}
.cv-sh .cv-looks i{width:44px;height:44px;border-radius:999px;border:1px solid rgba(0,0,0,.12);display:grid;place-items:end center;overflow:hidden}.cv-sh .cv-looks i b{width:100%;height:40%}
.cv-sh .cv-looks button[aria-checked=true]{border-color:var(--cv-ink)!important;box-shadow:inset 0 0 0 1px var(--cv-ink)}
.cv-sh .cv-icons{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.cv-sh .cv-icons button{aspect-ratio:1;border-radius:12px!important;border:1px solid var(--cv-line2)!important;background:#fff!important;display:grid;place-items:center;padding:0;margin:0}
.cv-sh .cv-icons button[aria-checked=true]{border-color:var(--cv-ink)!important;box-shadow:inset 0 0 0 1px var(--cv-ink)}.cv-sh .cv-icons .evs-ic{width:20px;height:20px}
.cv-sh .cv-add{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.cv-sh .cv-li{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--cv-line)}.cv-sh .cv-li small{color:var(--cv-soft)}
.cv-sh .cv-rowlist{display:grid}.cv-sh .cv-rowbtn{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;min-height:62px;padding:8px 0;border:0!important;border-top:1px solid var(--cv-line)!important;border-radius:0!important;background:none!important;text-align:left;margin:0}.cv-sh .cv-rowbtn:first-child{border-top:0!important}
.cv-sh .cv-rowbtn b{display:block;font-weight:600}.cv-sh .cv-rowbtn small{display:block;color:var(--cv-soft);font-size:15px}
@media (min-width:760px){#cv .cv-page{padding-top:28px;gap:16px}#cv textarea.cv-title{font-size:calc(48px * var(--tk,1))}.cv-sh-bg{align-items:center;padding:24px}.cv-sh{border-radius:22px;max-height:84vh}.cv-sh.wide{max-width:640px}#cv .cv-top{padding-left:24px;padding-right:24px}}
`;
  root.EventCanvas = { ...pure, open, close, isOpen: () => !!S?.el, state: () => S };
})(typeof window !== "undefined" ? window : globalThis);
