// PLMap: the shared map for Pottery Lab pages. The map view (/map) uses it; anything else that needs a map (brand
// booking, a host page) can too. MapLibre GL JS from unpkg (pinned, with its hash) over OpenFreeMap's keyless vector
// tiles, styled to Field Notes: linen land, soft grey roads, muted water, ink labels. No key, no account.
//
//   PLMap.mount(el, { center: { lat, lng }, zoom, tiles, lib, style, timeoutMs }) -> Promise<map controller>
//     tiles: what GET /api/public/map returns ({ kind: "openfreemap" | "style" | "off", source, glyphs, style })
//     style: a MapLibre style object to use instead (local previews)
//   It rejects when the library, WebGL or the first tiles don't load (offline, blocked, a slow network), so a page can
//   show its list instead: PLMap.mount(el, o).then(useMap, showList).
//   controller: setPlaces([{ id, lat, lng, exact, r, color, html, label, z }]), select(id), onPick(fn), flyTo({ lat, lng }, zoom),
//     fit(places), center() -> { lat, lng }, onMove(fn), you({ lat, lng }), resize(), map (the MapLibre map)
//
// Privacy: the page decides what is exact. An exact place is a pin with a point; anything else is drawn as a soft dashed
// circle of radius r metres with the object floating in it, so a home never looks like a pinned door. Areas come from
// the server already jittered and rounded (server/geo.js); this file never sees an address.
(function () {
  if (window.PLMap) return;
  const LIB = { js: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js", css: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css",
    jsHash: "sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj", cssHash: "sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V" };
  const ATTR = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  // Field Notes, as map colours
  const C = { land: "#EFEBE2", park: "#E1E3CF", wood: "#DCDFC8", water: "#CDD6D6", waterLine: "#B9C5C6", building: "#E5E0D4", buildingLine: "#D6CFC0", road: "#FAF8F3", roadCase: "#D3CDC1", major: "#F6F2E8", majorCase: "#C4BDAF", rail: "#BDB6A7", ink: "#1B1D1C", pencil: "#444845", halo: "#EFEBE2", blue: "#29489A" };

  /** The Field Notes style over OpenFreeMap's OpenMapTiles schema. */
  function fieldNotesStyle(t = {}) { const src = t.source || "https://tiles.openfreemap.org/planet", font = ["Noto Sans Regular"];
    const w = (a, b) => ["interpolate", ["exponential", 1.5], ["zoom"], 10, a, 18, b];
    return { version: 8, name: "Field Notes", glyphs: t.glyphs || "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      sources: { omt: { type: "vector", url: src, attribution: ATTR } },
      layers: [
        { id: "land", type: "background", paint: { "background-color": C.land } },
        { id: "wood", type: "fill", source: "omt", "source-layer": "landcover", filter: ["in", ["get", "class"], ["literal", ["wood", "grass", "farmland"]]], paint: { "fill-color": C.wood, "fill-opacity": 0.6 } },
        { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": C.park } },
        { id: "landuse", type: "fill", source: "omt", "source-layer": "landuse", filter: ["in", ["get", "class"], ["literal", ["cemetery", "pitch", "playground", "garden"]]], paint: { "fill-color": C.park, "fill-opacity": 0.7 } },
        { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": C.water } },
        { id: "waterway", type: "line", source: "omt", "source-layer": "waterway", paint: { "line-color": C.waterLine, "line-width": 1 } },
        { id: "building", type: "fill", source: "omt", "source-layer": "building", minzoom: 14, paint: { "fill-color": C.building, "fill-outline-color": C.buildingLine } },
        { id: "rail", type: "line", source: "omt", "source-layer": "transportation", filter: ["==", ["get", "class"], "rail"], paint: { "line-color": C.rail, "line-width": 1, "line-dasharray": [3, 3] } },
        { id: "road-case", type: "line", source: "omt", "source-layer": "transportation", filter: ["in", ["get", "class"], ["literal", ["minor", "service", "tertiary", "secondary"]]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": C.roadCase, "line-width": w(1.2, 14) } },
        { id: "road", type: "line", source: "omt", "source-layer": "transportation", filter: ["in", ["get", "class"], ["literal", ["minor", "service", "tertiary", "secondary"]]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": C.road, "line-width": w(0.6, 11) } },
        { id: "major-case", type: "line", source: "omt", "source-layer": "transportation", filter: ["in", ["get", "class"], ["literal", ["primary", "trunk", "motorway"]]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": C.majorCase, "line-width": w(2, 20) } },
        { id: "major", type: "line", source: "omt", "source-layer": "transportation", filter: ["in", ["get", "class"], ["literal", ["primary", "trunk", "motorway"]]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": C.major, "line-width": w(1, 16) } },
        { id: "water-name", type: "symbol", source: "omt", "source-layer": "water_name", layout: { "text-field": ["get", "name"], "text-font": font, "text-size": 11, "text-letter-spacing": 0.1 }, paint: { "text-color": "#6A7A7C", "text-halo-color": C.water, "text-halo-width": 1 } },
        { id: "road-name", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 15, layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": font, "text-size": 10 }, paint: { "text-color": C.pencil, "text-halo-color": C.halo, "text-halo-width": 1.4 } },
        { id: "hood", type: "symbol", source: "omt", "source-layer": "place", filter: ["in", ["get", "class"], ["literal", ["neighbourhood", "suburb", "quarter"]]], minzoom: 11, layout: { "text-field": ["upcase", ["get", "name"]], "text-font": font, "text-size": ["interpolate", ["linear"], ["zoom"], 11, 9, 15, 12], "text-letter-spacing": 0.18, "text-max-width": 8 }, paint: { "text-color": C.pencil, "text-halo-color": C.halo, "text-halo-width": 1.6 } },
        { id: "city", type: "symbol", source: "omt", "source-layer": "place", filter: ["in", ["get", "class"], ["literal", ["city", "town"]]], maxzoom: 13, layout: { "text-field": ["get", "name"], "text-font": font, "text-size": 14 }, paint: { "text-color": C.ink, "text-halo-color": C.halo, "text-halo-width": 1.6 } },
      ] }; }

  // ---- loading the library once ----
  let libP = null;
  function loadLib(lib = {}) { if (window.maplibregl) return Promise.resolve(window.maplibregl); if (libP) return libP;
    const js = lib.js || LIB.js, css = lib.css || LIB.css, pinned = js === LIB.js;
    libP = new Promise((res, rej) => { if (!document.querySelector(`link[data-plmap]`)) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = css; l.dataset.plmap = "1"; if (pinned) { l.integrity = LIB.cssHash; l.crossOrigin = "anonymous"; } document.head.appendChild(l); }
      const s = document.createElement("script"); s.src = js; s.async = true; if (pinned) { s.integrity = LIB.jsHash; s.crossOrigin = "anonymous"; }
      const t = setTimeout(() => rej(new Error("map library timed out")), 9000);
      s.onload = () => { clearTimeout(t); window.maplibregl ? res(window.maplibregl) : rej(new Error("map library missing")); }; s.onerror = () => { clearTimeout(t); rej(new Error("map library blocked")); };
      document.head.appendChild(s); }).catch((e) => { libP = null; throw e; });
    return libP; }
  const webgl = () => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } };

  /** Watch a new map until its first tiles draw: onReady once they do; onFail on a tile or style error first, or a timeout. */
  function watchTiles(map, { timeoutMs = 10000, onReady, onFail } = {}) { let done = false, drew = false;
    const finish = (ok, why) => { if (done) return; done = true; clearTimeout(t); try { ok ? onReady?.() : onFail?.(why); } catch {} };
    const t = setTimeout(() => finish(false, "timeout"), timeoutMs);
    map.on("error", (e) => { if (!drew) finish(false, (e && e.error && e.error.message) || "tiles"); });
    map.on("sourcedata", (e) => { if (e && e.tile && e.isSourceLoaded) drew = true; });
    map.on("idle", () => finish(true));
    return { get done() { return done; } }; }

  // a circle of radius r metres as a polygon, for areas
  function circle(lat, lng, r, n = 48) { const out = [], dLat = r / 111320, dLng = r / (111320 * Math.cos((lat * Math.PI) / 180)); for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; out.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]); } return out; }

  async function mount(el, o = {}) {
    if (o.tiles?.kind === "off") throw new Error("tiles off");
    if (!webgl()) throw new Error("no webgl");
    const ml = await loadLib(o.lib);
    const style = o.style || (o.tiles?.kind === "style" && o.tiles.style ? o.tiles.style : fieldNotesStyle(o.tiles || {}));
    const c = o.center || { lat: 40.71, lng: -73.97 };
    const map = new ml.Map({ container: el, style, center: [c.lng, c.lat], zoom: o.zoom ?? 12.5, minZoom: 3, maxZoom: 18, attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, cooperativeGestures: false, fadeDuration: 0 });
    map.touchZoomRotate?.disableRotation?.();
    map.addControl(new ml.AttributionControl({ compact: true, customAttribution: o.style ? "" : undefined }), "bottom-left");
    await new Promise((res, rej) => watchTiles(map, { timeoutMs: o.timeoutMs || 10000, onReady: res, onFail: (why) => { try { map.remove(); } catch {} rej(new Error(String(why || "tiles"))); } }));
    // areas: one source of circles, a soft fill and a dashed ring in the vibe's colour
    map.addSource("pl-areas", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "pl-area-fill", type: "fill", source: "pl-areas", paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "sel"], 0.26, 0.1] } });
    map.addLayer({ id: "pl-area-line", type: "line", source: "pl-areas", paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "sel"], 1.8, 1.1], "line-opacity": 0.8, "line-dasharray": [2, 2] } });
    const markers = new Map(); let places = [], sel = "", pickers = [], movers = [], youM = null;
    const drawAreas = () => map.getSource("pl-areas")?.setData({ type: "FeatureCollection", features: places.filter((p) => !p.exact && p.r).map((p) => ({ type: "Feature", properties: { id: p.id, color: p.id === sel ? "#E0B92E" : p.color || C.blue, sel: p.id === sel }, geometry: { type: "Polygon", coordinates: [circle(p.lat, p.lng, p.r)] } })) });
    function setPlaces(L) { places = (L || []).filter((p) => isFinite(p.lat) && isFinite(p.lng)); const keep = new Set(places.map((p) => p.id));
      for (const [id, m] of markers) if (!keep.has(id)) { m.remove(); markers.delete(id); }
      for (const p of places) { let m = markers.get(p.id); const html = p.html || "";
        if (!m) { const node = document.createElement("button"); node.type = "button"; node.className = "plmap-mk"; node.dataset.id = p.id; node.addEventListener("click", (e) => { e.stopPropagation(); pickers.forEach((f) => f(p.id)); });
          m = new ml.Marker({ element: node, anchor: p.exact ? "bottom" : "center" }).setLngLat([p.lng, p.lat]).addTo(map); markers.set(p.id, m); }
        const node = m.getElement(); if (node.dataset.html !== html) { node.innerHTML = html; node.dataset.html = html; } node.setAttribute("aria-label", p.label || ""); node.style.zIndex = p.id === sel ? 50 : p.z || 1; m.setLngLat([p.lng, p.lat]); }
      drawAreas(); }
    function select(id) { sel = id || ""; for (const [k, m] of markers) { m.getElement().style.zIndex = k === sel ? 50 : (places.find((p) => p.id === k)?.z || 1); } drawAreas(); }
    const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
    const flyTo = (p, zoom, pad) => { if (!p) return; const opt = { center: [p.lng, p.lat], zoom: zoom ?? Math.max(map.getZoom(), 13.5), padding: pad || o.padding?.() || undefined }; reduce() ? map.jumpTo(opt) : map.easeTo({ ...opt, duration: 600 }); };
    function fit(L, pad) { const P = (L || places).filter((p) => isFinite(p.lat)); if (!P.length) return; if (P.length === 1) return flyTo(P[0], 14, pad);
      const b = new ml.LngLatBounds(); P.forEach((p) => b.extend([p.lng, p.lat])); map.fitBounds(b, { padding: pad || o.padding?.() || 48, maxZoom: 14.5, duration: reduce() ? 0 : 500 }); }
    map.on("click", () => pickers.forEach((f) => f("")));
    map.on("moveend", () => { const c2 = map.getCenter(); movers.forEach((f) => f({ lat: c2.lat, lng: c2.lng })); });
    function you(p) { if (!p) return; if (!youM) { const n = document.createElement("span"); n.className = "plmap-you"; n.setAttribute("aria-label", "You are here"); youM = new ml.Marker({ element: n }).setLngLat([p.lng, p.lat]).addTo(map); } else youM.setLngLat([p.lng, p.lat]); }
    return { map, setPlaces, select, flyTo, fit, you, onPick: (f) => pickers.push(f), onMove: (f) => movers.push(f), center: () => { const c2 = map.getCenter(); return { lat: c2.lat, lng: c2.lng }; }, resize: () => map.resize() };
  }
  window.PLMap = { mount, fieldNotesStyle, watchTiles, loadLib, circle, LIB, ATTR };
})();
