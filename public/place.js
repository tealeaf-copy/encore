// Where you are: your city from your phone's location (with permission), from sign-up, or typed by you.
// Travel is noticed: when your phone is in a new city, Pottery Lab switches to it and says so. Everything stays on this device.
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
  function nearest(lat, lng) { let best = null, d = Infinity; for (const c of CITIES) { const m = miles(c, [0, lat, lng]); if (m < d) { d = m; best = c; } } return d < 120 ? best[0] : null; }
  /** Is a place (an event's city or neighbourhood) near my city? Unknown places fall back to a name match. */
  function near(place, mine, within = 60) { if (!mine) return true; const a = find(place), b = find(mine); if (a && b) return a === b || miles(a, b) <= within; return norm(place).includes(norm(mine)); }
  function get() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }
  function put(p) { try { localStorage.setItem(KEY, JSON.stringify({ ...p, at: Date.now() })); localStorage.setItem("encore.city", p.city || ""); } catch {} return p; }
  function gps(prompt) { return new Promise(async (res) => { if (!navigator.geolocation) return res(null); try { if (!prompt && navigator.permissions) { const s = await navigator.permissions.query({ name: "geolocation" }); if (s.state !== "granted") return res(null); } } catch {}
    navigator.geolocation.getCurrentPosition((pos) => res(nearest(pos.coords.latitude, pos.coords.longitude)), () => res(null), { maximumAge: 30 * 60e3, timeout: 8000, enableHighAccuracy: false }); }); }
  /** Work out the city. Returns { city, source, moved } and remembers it. */
  async function resolve({ prompt = false, fallback = "" } = {}) {
    const cur = get(); const g = await gps(prompt);
    if (g) { if (!cur) return { ...put({ city: g, source: "gps", gpsCity: g }), moved: false };
      if (cur.source === "manual" && cur.gpsCity === g) return cur;            // they corrected it here; keep their choice
      if (g !== cur.city) return { ...put({ city: g, source: "gps", gpsCity: g }), moved: true, from: cur.city }; // travelling
      return put({ ...cur, gpsCity: g }); }
    if (cur?.city) return cur; if (fallback) return put({ city: fallback, source: "profile" }); return { city: "", source: "none" };
  }
  function setManual(city) { const cur = get(); return put({ city: String(city || "").trim(), source: "manual", gpsCity: cur?.gpsCity || "" }); }
  /** A small "📍 New York · Change" control. onChange(city) runs when it changes. */
  function chip(el, onChange, { fallback = "" } = {}) {
    if (!el) return; const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const draw = (p, note) => { el.innerHTML = `<div class="place-chip"><span class="pc-pin" aria-hidden="true">📍</span>${p.city ? `<b>${esc(p.city)}</b>` : `<b>Anywhere</b>`}<button type="button" class="pc-edit">${p.city ? "Change" : "Set your city"}</button><button type="button" class="pc-gps" title="Use my location">Use my location</button>${note ? `<span class="pc-note">${esc(note)}</span>` : ""}</div>`;
      el.querySelector(".pc-edit").onclick = () => { el.innerHTML = `<form class="place-chip pc-form"><span class="pc-pin" aria-hidden="true">📍</span><input name="c" list="pcCities" value="${esc(p.city)}" placeholder="Type a city" autocomplete="off" data-1p-ignore data-lpignore="true" aria-label="Your city"><datalist id="pcCities">${CITIES.map((c) => `<option value="${esc(c[0])}">`).join("")}</datalist><button class="pc-save" type="submit">Save</button><button type="button" class="pc-any">Anywhere</button></form>`;
        const f = el.querySelector("form"); f.c.focus(); f.c.select(); f.onsubmit = (e) => { e.preventDefault(); const c = (find(f.c.value)?.[0]) || f.c.value.trim(); const np = setManual(c); draw(np); onChange && onChange(np.city); }; el.querySelector(".pc-any").onclick = () => { const np = setManual(""); draw(np); onChange && onChange(""); }; };
      el.querySelector(".pc-gps").onclick = async () => { el.querySelector(".pc-gps").textContent = "Finding you…"; const g = await gps(true); if (!g) { draw(p, "Couldn't get your location. Type your city instead."); return; } const np = put({ city: g, source: "gps", gpsCity: g }); draw(np, "Found you."); onChange && onChange(g); }; };
    const p0 = get() || { city: fallback || "" }; draw(p0);
    resolve({ prompt: !get() && !fallback, fallback }).then((p) => { if (p.city !== p0.city || p.moved) { draw(p, p.moved ? `You're in ${p.city}. Showing what's on here.` : ""); onChange && onChange(p.city); } });
  }
  window.EncorePlace = { CITIES, find, nearest, near, get, resolve, setManual, chip };
})();
