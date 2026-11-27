// Where you are: your city from your phone's location (with permission), from sign-up, or typed by you.
// Travel is noticed: when your phone is in a new city, Pottery Lab switches to it and says so. Everything stays on this device.
// One picker everywhere (feed header, Discover, Hosts): EncorePlace.sheet(), a bottom sheet on phones and a popover on desktop.
(function () {
  const CITIES = [
    ["New York", 40.71, -74.01, "brooklyn|manhattan|queens|bronx|nyc|williamsburg|greenpoint|bushwick|harlem|astoria"], ["Los Angeles", 34.05, -118.24, "la|silver lake|venice|santa monica"], ["San Francisco", 37.77, -122.42, "sf|oakland|berkeley"],
    ["Chicago", 41.88, -87.63], ["Boston", 42.36, -71.06, "cambridge|somerville"], ["Seattle", 47.61, -122.33], ["Austin", 30.27, -97.74], ["Denver", 39.74, -104.99], ["Miami", 25.76, -80.19],
    ["Washington", 38.91, -77.04, "dc"], ["Philadelphia", 39.95, -75.17], ["Atlanta", 33.75, -84.39], ["Dallas", 32.78, -96.8], ["Houston", 29.76, -95.37], ["Portland", 45.52, -122.68], ["San Diego", 32.72, -117.16],
    ["Nashville", 36.16, -86.78], ["Minneapolis", 44.98, -93.27], ["Toronto", 43.65, -79.38], ["Vancouver", 49.28, -123.12], ["Montreal", 45.5, -73.57], ["Mexico City", 19.43, -99.13, "cdmx"],
    ["London", 51.51, -0.13, "shoreditch|hackney|brixton|peckham"], ["Manchester", 53.48, -2.24], ["Edinburgh", 55.95, -3.19], ["Dublin", 53.35, -6.26], ["Paris", 48.86, 2.35], ["Berlin", 52.52, 13.4], ["Munich", 48.14, 11.58],
    ["Hamburg", 53.55, 9.99], ["Amsterdam", 52.37, 4.9], ["Brussels", 50.85, 4.35], ["Copenhagen", 55.68, 12.57], ["Stockholm", 59.33, 18.07], ["Oslo", 59.91, 10.75], ["Helsinki", 60.17, 24.94],
    ["Madrid", 40.42, -3.7], ["Barcelona", 41.39, 2.17], ["Lisbon", 38.72, -9.14], ["Rome", 41.9, 12.5], ["Milan", 45.46, 9.19], ["Zurich", 47.38, 8.54], ["Vienna", 48.21, 16.37], ["Prague", 50.08, 14.44],
    ["Warsaw", 52.23, 21.01], ["Budapest", 47.5, 19.04], ["Athens", 37.98, 23.73], ["Istanbul", 41.01, 28.98], ["Tel Aviv", 32.09, 34.78], ["Dubai", 25.2, 55.27], ["Cairo", 30.04, 31.24], ["Lagos", 6.52, 3.38],
    ["Nairobi", -1.29, 36.82], ["Accra", 5.6, -0.19], ["Cape Town", -33.92, 18.42], ["Johannesburg", -26.2, 28.05], ["Mumbai", 19.08, 72.88], ["Delhi", 28.61, 77.21], ["Bangalore", 12.97, 77.59, "bengaluru"],
    ["Singapore", 1.35, 103.82], ["Bangkok", 13.76, 100.5], ["Jakarta", -6.21, 106.85], ["Manila", 14.6, 120.98], ["Ho Chi Minh City", 10.82, 106.63, "saigon"], ["Hanoi", 21.03, 105.85], ["Hong Kong", 22.32, 114.17],
    ["Taipei", 25.03, 121.57], ["Seoul", 37.57, 126.98], ["Tokyo", 35.68, 139.69], ["Osaka", 34.69, 135.5], ["Shanghai", 31.23, 121.47], ["Beijing", 39.9, 116.4], ["Sydney", -33.87, 151.21, "surry hills|bondi|newtown"],
    ["Melbourne", -37.81, 144.96], ["Brisbane", -27.47, 153.03], ["Auckland", -36.85, 174.76], ["São Paulo", -23.55, -46.63, "sao paulo"], ["Rio de Janeiro", -22.91, -43.17, "rio"], ["Buenos Aires", -34.6, -58.38],
    ["Bogotá", 4.71, -74.07, "bogota"], ["Lima", -12.05, -77.04], ["Santiago", -33.45, -70.67],
  ];
  const KEY = "encore.place", norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const miles = (a, b) => { const R = 3958.8, r = (x) => (x * Math.PI) / 180, dl = r(b[1] - a[1]), dg = r(b[2] - a[2]), h = Math.sin(dl / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  function find(name) { const n = norm(name); if (!n) return null; return CITIES.find((c) => norm(c[0]) === n) || CITIES.find((c) => c[3] && new RegExp(`\\b(${c[3]})\\b`).test(n)) || CITIES.find((c) => n.includes(norm(c[0])) || norm(c[0]).includes(n)) || null; }
  /** The cities closest to a point, nearest first: [[name, miles], ...]. */
  function closest(lat, lng, n = 3) { return CITIES.map((c) => [c[0], miles(c, [0, lat, lng])]).sort((a, b) => a[1] - b[1]).slice(0, n); }
  /** The city you're in, or null when you're far (250+ miles) from every city we know. */
  function nearest(lat, lng, within = 250) { const [c] = closest(lat, lng, 1); return c && c[1] < within ? c[0] : null; }
  /** Is a place (an event's city or neighbourhood) near my city? Unknown places fall back to a name match. */
  function near(place, mine, within = 60) { if (!mine) return true; const a = find(place), b = find(mine); if (a && b) return a === b || miles(a, b) <= within; return norm(place).includes(norm(mine)); }
  function get() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }
  function put(p) { try { localStorage.setItem(KEY, JSON.stringify({ ...p, at: Date.now() })); localStorage.setItem("encore.city", p.city || ""); } catch {} return p; }
  // What we say when your location can't be read, one line per reason (never the same "couldn't" for everything).
  const GPS_MSG = {
    denied: "Location is off for this site. On iPhone: Settings, Privacy & Security, Location Services, Safari Websites, While Using. Or pick a city below.",
    timeout: "That took too long. Try again, or pick a city.",
    unavailable: "Your phone couldn't find a location right now. Pick a city, or try again in a moment.",
    unsupported: "This browser can't share your location. Pick a city below.",
    insecure: "Location only works on a secure (https) page. Pick a city below.",
    far: "Found you, but we don't have your area yet. Pick the closest city:",
  };
  const gpsMessage = (code) => GPS_MSG[code] || GPS_MSG.unavailable;
  /** Ask the phone where it is. Resolves { ok, city, lat, lng, closest } or { ok: false, code, message, closest? }.
   *  One coarse try, 15s, a fix up to 5 minutes old is fine; a timeout is reported, not retried with high accuracy. */
  function locate() { return new Promise((res) => {
    const fail = (code, extra) => res({ ok: false, code, message: gpsMessage(code), ...(extra || {}) });
    if (typeof window !== "undefined" && window.isSecureContext === false) return fail("insecure");
    const G = typeof navigator !== "undefined" && navigator.geolocation; if (!G || !G.getCurrentPosition) return fail("unsupported");
    try { G.getCurrentPosition((pos) => { const lat = pos.coords.latitude, lng = pos.coords.longitude, near3 = closest(lat, lng, 3), city = nearest(lat, lng);
        if (!city) return fail("far", { lat, lng, closest: near3.map((c) => c[0]) });
        res({ ok: true, city, lat, lng, closest: near3.map((c) => c[0]) }); },
      (err) => fail(err && err.code === 1 ? "denied" : err && err.code === 3 ? "timeout" : "unavailable"),
      { maximumAge: 5 * 60e3, timeout: 15000, enableHighAccuracy: false }); } catch { fail("unavailable"); }
  }); }
  /** Quietly: the city from GPS only if permission was already given (never shows a prompt unless asked). */
  function gps(prompt) { return new Promise(async (res) => { if (typeof navigator === "undefined" || !navigator.geolocation) return res(null); try { if (!prompt && navigator.permissions) { const s = await navigator.permissions.query({ name: "geolocation" }); if (s.state !== "granted") return res(null); } } catch {}
    const r = await locate(); res(r.ok ? r.city : null); }); }
  /** A tap on "Use my location": always the phone's answer, never a stale saved choice. Saves it on success. */
  async function useGps() { const r = await locate(); if (r.ok) { remember(r.city); put({ city: r.city, source: "gps", gpsCity: r.city }); } return r; }
  /** Work out the city. Returns { city, source, moved } and remembers it. prompt: true is an explicit ask, and a GPS answer wins. */
  async function resolve({ prompt = false, fallback = "" } = {}) {
    const cur = get(); const g = await gps(prompt);
    if (g) { if (prompt) return { ...put({ city: g, source: "gps", gpsCity: g }), moved: !!cur?.city && cur.city !== g, from: cur?.city || "" };
      if (!cur) return { ...put({ city: g, source: "gps", gpsCity: g }), moved: false };
      if (cur.source === "manual" && cur.gpsCity === g) return cur;            // they corrected it here; keep their choice
      if (g !== cur.city) return { ...put({ city: g, source: "gps", gpsCity: g }), moved: true, from: cur.city }; // travelling
      return put({ ...cur, gpsCity: g }); }
    if (cur?.city) return cur; if (fallback) return put({ city: fallback, source: "profile" }); return { city: "", source: "none" };
  }
  // ---- recent cities: the last four you picked, on this device ----
  const RKEY = "encore.recentCities";
  function recent() { try { const L = JSON.parse(localStorage.getItem(RKEY) || "[]"); return Array.isArray(L) ? L.filter((x) => typeof x === "string" && x.trim()).slice(0, 4) : []; } catch { return []; } }
  function remember(city) { const c = String(city || "").trim(); if (!c) return; try { localStorage.setItem(RKEY, JSON.stringify([c, ...recent().filter((x) => norm(x) !== norm(c))].slice(0, 4))); } catch {} }
  function setManual(city) { const cur = get(); const c = String(city || "").trim(); remember(c); return put({ city: c, source: "manual", gpsCity: cur?.gpsCity || "" }); }
  /** What the chip says: "San Francisco", "Near you · San Francisco", or "Anywhere". */
  const label = (p) => (p?.city ? (p.source === "gps" ? `Near you · ${p.city}` : p.city) : "Anywhere");
  // cities where Pottery Lab has events coming up, busiest first (asked once per page)
  let placesP = null;
  const eventCities = () => placesP || (placesP = fetch("/api/public/places", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : { cities: [] })).then((j) => (Array.isArray(j.cities) ? j.cities : [])).catch(() => []));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const PIN = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M8 14.5s4.5-4.2 4.5-7.7A4.5 4.5 0 0 0 3.5 6.8c0 3.5 4.5 7.7 4.5 7.7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="6.8" r="1.6" fill="currentColor"/></svg>`;
  const ARROW = `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false"><path d="M14 2 2 7.2l5.2 1.6L8.8 14z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  function css() { if (typeof document === "undefined" || document.getElementById("pls-css")) return; const st = document.createElement("style"); st.id = "pls-css";
    st.textContent = `.pls-back{position:fixed;inset:0;z-index:80;background:rgba(27,29,28,.32);display:flex;align-items:flex-end;justify-content:center}
.pls-back.pls-wide{background:transparent;display:block}
.pls{position:relative;box-sizing:border-box;width:100%;max-width:520px;max-height:min(86vh,640px);overflow:auto;overscroll-behavior:contain;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);border-radius:6px 6px 0 0;padding:8px 16px calc(16px + env(safe-area-inset-bottom,0px));font:400 16px/1.4 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);box-shadow:0 -1.5px 0 var(--pl-ink,#1B1D1C);transition:transform .18s ease-out;outline:none}
.pls-wide .pls{position:fixed;width:360px;border-radius:6px;box-shadow:0 0 0 1.5px var(--pl-ink,#1B1D1C),0 12px 32px rgba(27,29,28,.14);padding:12px 16px 16px}
.pls-grab{width:40px;height:4px;border-radius:2px;background:var(--pl-line,#CFC8B9);margin:2px auto 6px}.pls-wide .pls-grab{display:none}
.pls-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.pls-head h2{margin:0;font:600 18px/1.3 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);letter-spacing:-.01em}
.pls-x{min-width:44px;min-height:44px;margin-right:-10px;border:0;background:none;color:var(--pl-ink,#1B1D1C);font:400 26px/1 var(--pl-font-text,system-ui);cursor:pointer;border-radius:6px}
.pls-now{margin:0 0 12px;color:var(--pl-soft,#444845);font-size:14px}.pls-now b{color:var(--pl-ink,#1B1D1C);font-weight:600}
.pls-gps{display:flex;align-items:center;gap:12px;width:100%;min-height:56px;box-sizing:border-box;padding:10px 12px;border:1.5px solid var(--pl-accent,#29489A);border-radius:6px;background:var(--pl-accent-soft,#E3E8F4);color:var(--pl-accent-text,#29489A);text-align:left;font:inherit;cursor:pointer}
.pls-gps b{display:block;font-weight:600;font-size:16px}.pls-gps small{display:block;color:var(--pl-soft,#444845);font-size:13px;line-height:1.35;margin-top:2px}.pls-gps[disabled]{opacity:.75;cursor:progress}
.pls-msg{margin:10px 0 0;padding:10px 12px;border-radius:6px;background:var(--pl-warning-soft,#F7EFCB);color:var(--pl-ink,#1B1D1C);font-size:14px;line-height:1.45}.pls-msg .pls-chips{margin-top:8px}
.pls-sec h3{margin:16px 0 8px;font:500 12px/1.2 var(--pl-font-mono,"IBM Plex Mono",ui-monospace,monospace);letter-spacing:.04em;text-transform:uppercase;color:var(--pl-soft,#444845)}
.pls-chips{display:flex;flex-wrap:wrap;gap:8px}
.pls-chip{display:inline-flex;align-items:center;gap:6px;min-height:44px;box-sizing:border-box;padding:0 14px;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;background:#fff;color:var(--pl-ink,#1B1D1C);font:500 15px/1.2 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);cursor:pointer}
.pls-chip small{color:var(--pl-soft,#444845);font-size:12px;font-weight:400}.pls-chip[aria-pressed=true]{border-color:var(--pl-ink,#1B1D1C);background:var(--pl-ink,#1B1D1C);color:#fff}.pls-chip[aria-pressed=true] small{color:#fff}
.pls-any{margin-top:12px}.pls-wait{color:var(--pl-soft,#444845);font-size:14px;min-height:44px;display:inline-flex;align-items:center}
.pls-search{display:block;margin-top:16px;padding-top:12px;border-top:1px dashed var(--pl-line,#CFC8B9)}.pls-search span{display:block;font-size:13px;color:var(--pl-soft,#444845);margin-bottom:6px}
.pls-search input{width:100%;box-sizing:border-box;min-height:44px;padding:0 12px;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;background:#fff;color:var(--pl-ink,#1B1D1C);font:400 16px/1.2 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)}
.pls-search input:focus,.pls-chip:focus-visible,.pls-gps:focus-visible,.pls-x:focus-visible,.pls-opt:focus-visible{outline:3px solid var(--pl-focus,rgba(41,72,154,.3));outline-offset:2px}
.pls-sugg{display:grid;margin-top:4px}.pls-sugg:empty{display:none}
.pls-opt{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;padding:0 4px;border:0;border-bottom:1px dashed var(--pl-line,#CFC8B9);background:none;color:var(--pl-ink,#1B1D1C);font:inherit;text-align:left;cursor:pointer}.pls-opt small{color:var(--pl-soft,#444845);font-size:13px}
@media (prefers-reduced-motion:reduce){.pls{transition:none}}`;
    document.head.appendChild(st); }
  let openSheet = null;
  /** The one city picker: a bottom sheet on phones, a small popover by the button on wider screens.
   *  Use my location, recent cities, cities with events, Anywhere, then a search field. A pick applies at once and closes.
   *  onPick(city, source) runs after the choice is saved ("" is Anywhere; source is "gps" or "manual"). */
  function sheet({ anchor = null, current, cities, title = "Where?", listLabel = "Where events are", onPick } = {}) {
    if (typeof document === "undefined") return null; css(); if (openSheet) openSheet.close(false);
    const p0 = get() || {}, cur = current != null ? String(current) : p0.city || "";
    const wide = typeof matchMedia === "function" && matchMedia("(min-width: 700px)").matches && anchor;
    const back = document.createElement("div"); back.className = "pls-back" + (wide ? " pls-wide" : "");
    const el = document.createElement("div"); el.className = "pls"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "plsH"); el.tabIndex = -1;
    el.innerHTML = `<div class="pls-grab" aria-hidden="true"></div><div class="pls-head"><h2 id="plsH">${esc(title)}</h2><button type="button" class="pls-x" aria-label="Close">×</button></div>
      <p class="pls-now">${cur ? `Showing <b>${esc(cur)}</b>` : "Showing everywhere"}</p>
      <button type="button" class="pls-gps">${ARROW}<span><b>Use my location</b><small>One tap. We only use it to pick your city. It stays on this phone.</small></span></button>
      <div class="pls-msg" aria-live="polite" hidden></div>
      <div class="pls-sec" data-sec="recent" hidden><h3>Recent</h3><div class="pls-chips"></div></div>
      <div class="pls-sec" data-sec="events"><h3>${esc(listLabel)}</h3><div class="pls-chips"><span class="pls-wait">Loading…</span></div></div>
      <div class="pls-chips pls-any"><button type="button" class="pls-chip" data-city="" aria-pressed="${!cur}">Anywhere</button></div>
      <label class="pls-search"><span>Or search for a city</span><input type="search" enterkeyhint="go" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="Type a city" data-1p-ignore data-lpignore="true"></label>
      <div class="pls-sugg" role="list"></div>`;
    back.appendChild(el); document.body.appendChild(back);
    const $ = (s) => el.querySelector(s), html = document.documentElement, prevOverflow = html.style.overflow; if (!wide) html.style.overflow = "hidden";
    if (wide) { const r = anchor.getBoundingClientRect(), w = Math.min(360, innerWidth - 32); el.style.width = w + "px"; el.style.left = Math.max(16, Math.min(r.left, innerWidth - w - 16)) + "px";
      const below = innerHeight - r.bottom - 16; if (below >= 320 || below >= r.top) { el.style.top = r.bottom + 8 + "px"; el.style.maxHeight = Math.max(240, below - 8) + "px"; } else { el.style.bottom = innerHeight - r.top + 8 + "px"; el.style.maxHeight = Math.max(240, r.top - 24) + "px"; } }
    const chipFor = (c, n) => `<button type="button" class="pls-chip" data-city="${esc(c)}" aria-pressed="${norm(c) === norm(cur)}">${esc(c)}${n ? ` <small>${n}</small>` : ""}</button>`;
    const wireChips = (root) => root.querySelectorAll("[data-city]").forEach((b) => { if (!b.dataset.w) { b.dataset.w = 1; b.onclick = () => pick(b.dataset.city, "manual"); } });
    const rec = recent(); if (rec.length) { const s = $('[data-sec="recent"]'); s.hidden = false; s.querySelector(".pls-chips").innerHTML = rec.map((c) => chipFor(c)).join(""); }
    let known = [];
    Promise.resolve(cities ? (typeof cities === "function" ? cities() : cities) : null).then((L) => (L && L.length ? L : eventCities())).then((L) => { if (!el.isConnected) return;
      known = (L || []).map((x) => (typeof x === "string" ? { city: x } : x)).filter((x) => x && x.city).slice(0, 12); const box = $('[data-sec="events"] .pls-chips');
      const seen = new Set(rec.map(norm)), show = known.filter((x) => !seen.has(norm(x.city))).slice(0, 8);
      if (show.length) box.innerHTML = show.map((x) => chipFor(x.city, x.n)).join(""); else $('[data-sec="events"]').hidden = true; wireChips(el); }).catch(() => { $('[data-sec="events"]').hidden = true; });
    wireChips(el);
    function close(refocus = true) { if (!back.isConnected) return; back.remove(); html.style.overflow = prevOverflow; document.removeEventListener("keydown", onKey, true); if (openSheet?.el === el) openSheet = null; if (refocus && anchor && anchor.isConnected) try { anchor.focus({ preventScroll: true }); } catch {} }
    function pick(city, source) { const c = String(city || "").trim(); if (source !== "gps") setManual(c); close(); onPick && onPick(c, source || "manual"); }
    const msg = (t, near) => { const m = $(".pls-msg"); m.hidden = !t; m.innerHTML = t ? `${esc(t)}${near && near.length ? `<div class="pls-chips">${near.map((c) => chipFor(c)).join("")}</div>` : ""}` : ""; wireChips(m); };
    $(".pls-gps").onclick = async () => { const b = $(".pls-gps"); if (b.disabled) return; b.disabled = true; const t = b.querySelector("b"); t.textContent = "Finding you…"; msg("");
      const r = await useGps(); if (!el.isConnected) return; b.disabled = false; t.textContent = "Use my location";
      if (r.ok) return pick(r.city, "gps"); msg(r.message, r.closest); };
    const inp = $(".pls-search input"), sugg = $(".pls-sugg");
    const suggest = () => { const q = norm(inp.value); if (!q) { sugg.innerHTML = ""; return; }
      const evN = new Map(known.map((x) => [norm(x.city), x.n])), pool = [...known.map((x) => x.city), ...CITIES.map((c) => c[0])], out = [];
      for (const c of pool) { if (out.length >= 6) break; const n = norm(c); if (out.some((o) => norm(o) === n)) continue; const hit = n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q)); const alias = !hit && CITIES.find((x) => x[0] === c && x[3] && x[3].split("|").some((a) => a.startsWith(q))); if (hit || alias) out.push(c); }
      if (!out.some((o) => norm(o) === q) && inp.value.trim().length >= 2) out.push(inp.value.trim());
      sugg.innerHTML = out.map((c) => `<button type="button" class="pls-opt" role="listitem" data-city="${esc(c)}"><span>${esc(c)}</span><small>${evN.get(norm(c)) ? `${evN.get(norm(c))} coming up` : find(c) ? "" : "Use this"}</small></button>`).join(""); wireChips(sugg); };
    inp.addEventListener("input", suggest);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const first = sugg.querySelector("[data-city]"); if (first) pick((find(first.dataset.city)?.[0]) || first.dataset.city, "manual"); } });
    $(".pls-x").onclick = () => close();
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key === "Tab") { const F = [...el.querySelectorAll("button:not([disabled]),input")].filter((x) => x.offsetParent !== null); if (!F.length) return; const a = F[0], z = F[F.length - 1];
        if (e.shiftKey && (document.activeElement === a || document.activeElement === el)) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } } }
    document.addEventListener("keydown", onKey, true);
    // swipe down to close (phones): from the top of the sheet, past 80px
    if (!wide) { let y0 = null, dy = 0; el.addEventListener("touchstart", (e) => { y0 = el.scrollTop <= 0 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
      el.addEventListener("touchmove", (e) => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); el.style.transform = dy ? `translateY(${dy}px)` : ""; }, { passive: true });
      el.addEventListener("touchend", () => { if (y0 == null) return; y0 = null; if (dy > 80) close(); else el.style.transform = ""; }); }
    try { el.focus({ preventScroll: true }); } catch {}
    openSheet = { el, close }; return openSheet;
  }
  /** The place chip: "Showing San Francisco  Change", one button. A tap opens the sheet; onChange(city) runs on a pick. */
  function chip(el, onChange, { fallback = "" } = {}) {
    if (!el) return;
    const draw = (p) => { el.innerHTML = `<button type="button" class="pc-btn" aria-haspopup="dialog"><span class="pc-pin" aria-hidden="true">${PIN}</span><span class="pc-lbl">Showing <b>${esc(p.city || "Anywhere")}</b>${p.city && p.source === "gps" ? `<span class="pc-near"> · near you</span>` : ""}</span><span class="pc-chg">Change</span></button>`;
      const b = el.querySelector("button"); b.setAttribute("aria-label", `Showing ${label(p)}. Change city`);
      b.onclick = () => sheet({ anchor: b, onPick: (c) => { draw(get() || { city: c }); onChange && onChange(c); const nb = el.querySelector("button"); if (nb) try { nb.focus({ preventScroll: true }); } catch {} } }); };
    const p0 = get() || { city: fallback || "" }; draw(p0);
    // quietly: only when location is already allowed (no permission prompt on page load); travel is noticed the same way
    resolve({ prompt: false, fallback }).then((p) => { if (p.city !== p0.city || p.moved) { draw(p); onChange && onChange(p.city); } });
  }
  window.EncorePlace = { CITIES, find, nearest, closest, near, get, resolve, setManual, chip, sheet, label, recent, locate, useGps, gpsMessage };
})();
