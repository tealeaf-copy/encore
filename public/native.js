// The bridge to the iOS and Android apps (Capacitor, see mobile/). On the web it does nothing at all: it returns on
// its first line unless the page runs inside the app. Inside the app it routes what the web already does to the
// phone's own features, without the pages knowing:
// - share buttons (navigator.share) open the native share sheet
// - photo pickers (<input type=file accept=image/...>) offer the camera or the photo library
// - "Add to calendar" links (Google Calendar, .ics) add the event to the phone's calendar
// - links that open the app (universal links / App Links) and taps on a push go to the right page
// - pushes: asks once, after you've done something that earns a push (replied, followed, posted), and registers the device
// - light haptics on "I'm in", the status bar matches the page, the splash screen hides when the page is drawn
// Plugins are reached through window.Capacitor (the app loads the live site, nothing is bundled), by name.
(function () {
  "use strict";
  const Cap = window.Capacitor;
  if (!Cap || typeof Cap.isNativePlatform !== "function" || !Cap.isNativePlatform() || window.__encoreNative) return;
  window.__encoreNative = 1;
  const platform = Cap.getPlatform ? Cap.getPlatform() : "ios"; // "ios" | "android"
  const plugin = (name) => { try { return (Cap.Plugins && Cap.Plugins[name]) || (Cap.isPluginAvailable && Cap.isPluginAvailable(name) && Cap.registerPlugin ? Cap.registerPlugin(name) : null); } catch { return null; } };
  const has = (name) => { try { return Cap.isPluginAvailable ? Cap.isPluginAvailable(name) : !!plugin(name); } catch { return false; } };
  const root = document.documentElement;
  root.classList.add("is-app", "is-native", "is-" + platform);
  const log = (...a) => { try { console.log("[native]", ...a); } catch {} };

  // ---- layout: the page runs edge to edge, so pad for the notch where the page doesn't already ----
  function safeArea() {
    let vp = document.querySelector('meta[name="viewport"]'); if (!vp) { vp = document.createElement("meta"); vp.name = "viewport"; vp.content = "width=device-width,initial-scale=1"; document.head.appendChild(vp); }
    if (!/viewport-fit=cover/.test(vp.content)) vp.content += ",viewport-fit=cover";
    const st = document.createElement("style"); st.id = "native-css";
    st.textContent = "html.is-app.pad-top body{padding-top:env(safe-area-inset-top,0px)}html.is-app{-webkit-tap-highlight-color:transparent}html.is-app body{overscroll-behavior-y:none}" +
      // App Store 3.1.1: plans for teams and brands are bought on the web, never from inside the app
      "html.is-app a[href^='/pricing'],html.is-app a[href*='/upgrade'],html.is-app [data-upgrade],html.is-app .upgrade-cta{display:none!important}";
    document.head.appendChild(st);
    requestAnimationFrame(() => { const pt = parseFloat(getComputedStyle(root).paddingTop) || 0; if (!pt) root.classList.add("pad-top"); });
  }

  // ---- share ----
  const Share = plugin("Share");
  if (Share && has("Share")) {
    const nativeShare = async (data = {}) => { const d = { title: data.title || document.title, text: data.text || "", url: data.url ? new URL(data.url, location.href).href : undefined, dialogTitle: "Share" };
      try { await Share.share(d); haptic("light"); } catch (e) { if (!/cancel/i.test(String(e?.message || e))) throw e; throw new DOMException("Share canceled", "AbortError"); } };
    try { Object.defineProperty(navigator, "share", { value: nativeShare, configurable: true, writable: true }); Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true, writable: true }); } catch {}
  }

  // ---- camera and photo library for photo pickers ----
  const Camera = plugin("Camera");
  async function pickPhotos(input) {
    const many = input.multiple, src = /capture/.test(input.outerHTML) ? "CAMERA" : "PROMPT";
    let files = [];
    if (many && Camera.pickImages && src !== "CAMERA") { const r = await Camera.pickImages({ quality: 85, limit: 10, width: 2400 }); for (const p of r.photos || []) files.push(await toFile(p.webPath, p.format)); }
    else { const p = await Camera.getPhoto({ quality: 85, resultType: "uri", source: src, width: 2400, correctOrientation: true, promptLabelHeader: "Add a photo", promptLabelPhoto: "From your photos", promptLabelPicture: "Take a photo" }); files.push(await toFile(p.webPath, p.format)); }
    const dt = new DataTransfer(); for (const f of files) dt.items.add(f); input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  async function toFile(webPath, format = "jpeg") { const b = await (await fetch(webPath)).blob(); const ext = format === "png" ? "png" : format === "heic" ? "heic" : "jpg"; return new File([b], `photo-${Date.now()}.${ext}`, { type: b.type || "image/" + (ext === "jpg" ? "jpeg" : ext) }); }
  if (Camera && has("Camera") && typeof DataTransfer === "function") {
    document.addEventListener("click", (ev) => {
      const input = ev.target && ev.target.closest && ev.target.closest('input[type="file"]'); if (!input || input.disabled) return;
      const accept = String(input.accept || ""); if (!/image/.test(accept) || /video/.test(accept)) return; // videos keep the system picker
      ev.preventDefault(); pickPhotos(input).catch((e) => { if (!/cancel/i.test(String(e?.message || e))) log("camera", e); });
    }, true);
  }

  // ---- add to calendar ----
  const Cal = plugin("CapacitorCalendar");
  function fromGoogle(href) {
    const u = new URL(href), q = u.searchParams, [a, b] = String(q.get("dates") || "").split("/");
    const parse = (s) => { const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(s || ""); if (!m) return null; return m[4] ? (m[7] ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]).getTime()) : new Date(+m[1], m[2] - 1, +m[3]).getTime(); };
    const start = parse(a), end = parse(b) || (start ? start + 3 * 3600e3 : null); if (!start) return null;
    return { title: q.get("text") || document.title, location: q.get("location") || "", description: q.get("details") || "", startDate: start, endDate: end, isAllDay: !/T/.test(a || "") };
  }
  async function fromIcs(href) {
    const t = await (await fetch(href, { credentials: "same-origin" })).text(), get = (k) => { const m = new RegExp("^" + k + "[^:]*:(.*)$", "m").exec(t.replace(/\r?\n[ \t]/g, "")); return m ? m[1].replace(/\\([,;n])/g, (x, c) => (c === "n" ? "\n" : c)).trim() : ""; };
    const d = (s) => { const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?/.exec(s); if (!m) return null; return m[7] ? Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime(); };
    const start = d(get("DTSTART")); if (!start) return null;
    return { title: get("SUMMARY") || document.title, location: get("LOCATION"), description: get("DESCRIPTION"), startDate: start, endDate: d(get("DTEND")) || start + 3 * 3600e3, url: get("URL") || undefined };
  }
  if (Cal && has("CapacitorCalendar")) {
    document.addEventListener("click", async (ev) => {
      const a = ev.target && ev.target.closest && ev.target.closest("a[href]"); if (!a) return;
      const href = a.href, google = /^https:\/\/calendar\.google\.com\/calendar\/(render|r\/eventedit)/.test(href), ics = /\.ics(\?|$)|[?&]format=ics\b|\/ics\//.test(href) && !/^webcal:/.test(href);
      if (!google && !ics) return;
      ev.preventDefault();
      try { const e = google ? fromGoogle(href) : await fromIcs(href); if (!e) throw new Error("no date");
        await Cal.createEventWithPrompt(e); haptic("success");
      } catch (e) { if (!/cancel/i.test(String(e?.message || e))) { log("calendar", e); const B = plugin("Browser"); if (B) B.open({ url: href }); else location.href = href; } }
    }, true);
  }

  // ---- links into the app, and taps on a push ----
  const App = plugin("App");
  const go = (url) => { try { const u = new URL(url, location.href); const ours = u.origin === location.origin || /(^|\.)potterylab\.(ai|com|app)$/.test(u.hostname); if (!ours) return; const to = u.pathname + u.search + u.hash; if (to !== location.pathname + location.search + location.hash) location.assign(to); } catch {} };
  if (App) {
    App.addListener("appUrlOpen", (e) => go(e.url));
    App.addListener("backButton", (e) => { if (e.canGoBack) history.back(); else App.exitApp?.(); }); // Android
    // iOS: a swipe in from the left edge goes back a page, like Safari (mobile/native-config/ios/MainViewController.swift
    // turns on the WebView's own gesture; this covers builds without it). Not while a sheet or a drag is open.
    if (/iP(hone|ad|od)/.test(navigator.userAgent) || Cap?.getPlatform?.() === "ios") { let sx = -1, sy = 0;
      document.addEventListener("touchstart", (e) => { const t = e.touches[0]; sx = e.touches.length === 1 && t.clientX < 24 && !document.querySelector('[aria-modal="true"]') ? t.clientX : -1; sy = t.clientY; }, { passive: true });
      document.addEventListener("touchend", (e) => { if (sx < 0) return; const t = e.changedTouches[0]; if (t.clientX - sx > 90 && Math.abs(t.clientY - sy) < 60 && history.length > 1) history.back(); sx = -1; }, { passive: true }); }
    App.addListener("appStateChange", (s) => { if (s.isActive) document.dispatchEvent(new CustomEvent("encore:resume")); });
  }

  // ---- push ----
  const Push = plugin("PushNotifications");
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  async function registerPush({ ask = false } = {}) {
    if (!Push || !signedIn()) return;
    let p = await Push.checkPermissions(); if (p.receive === "prompt" && ask) p = await Push.requestPermissions();
    if (p.receive === "granted") await Push.register();
  }
  if (Push) {
    let token = "";
    // signing out: this phone stops getting that person's pushes
    document.addEventListener("click", (ev) => { const a = ev.target && ev.target.closest && ev.target.closest(".es-out,#signOutM a,[data-signout]"); if (a && token) fetch("/api/me/push/devices/" + encodeURIComponent(token), { method: "DELETE", credentials: "same-origin", keepalive: true }).catch(() => {}); }, true);
    Push.addListener("registration", (t) => { token = t.value; fetch("/api/me/push/devices", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: t.value, platform, app: "capacitor" }) }).catch(() => {}); });
    Push.addListener("registrationError", (e) => log("push registration", e));
    Push.addListener("pushNotificationActionPerformed", (a) => go(a?.notification?.data?.link || "/feed"));
    registerPush().catch(() => {}); // already allowed: refresh the token
    // ask once, right after something a push would follow up on (not on first launch)
    let asked = false; try { asked = localStorage.getItem("encore.pushAsked") === "1"; } catch {}
    const earn = /\/api\/(public\/rsvp|db\/collection\?path=rsvps|me\/posts|public\/follow|me\/friends|me\/saves)/;
    const f0 = window.fetch; window.fetch = function (input, init) { const p = f0.apply(this, arguments); try { const url = typeof input === "string" ? input : input.url, m = (init && init.method) || (input && input.method) || "GET";
        if (!asked && m !== "GET" && earn.test(url)) p.then((r) => { if (r.ok && !asked) { asked = true; try { localStorage.setItem("encore.pushAsked", "1"); } catch {} setTimeout(() => registerPush({ ask: true }).catch(() => {}), 1200); } }).catch(() => {}); } catch {} return p; };
    window.EncoreNativePush = { ask: () => registerPush({ ask: true }) };
  }

  // ---- haptics ----
  const Haptics = plugin("Haptics");
  function haptic(kind) { if (!Haptics) return; try { if (kind === "success") Haptics.notification({ type: "SUCCESS" }); else Haptics.impact({ style: kind === "medium" ? "MEDIUM" : "LIGHT" }); } catch {} }
  document.addEventListener("click", (ev) => { const b = ev.target && ev.target.closest && ev.target.closest("button,[role=button]"); if (b && /^\s*I'm in\b/i.test(b.textContent || "")) haptic("medium"); }, true);

  // ---- status bar and splash ----
  const Bar = plugin("StatusBar"), Splash = plugin("SplashScreen");
  function bar() { if (!Bar) return; try { const dark = false; /* the app is light everywhere: one calm look, whatever the phone is set to */ Bar.setStyle({ style: dark ? "DARK" : "LIGHT" }); if (platform === "android") { Bar.setOverlaysWebView({ overlay: false }); Bar.setBackgroundColor({ color: dark ? "#15110E" : "#F7F1E8" }); } } catch {} }

  const ready = () => { safeArea(); bar(); try { Splash && Splash.hide({ fadeOutDuration: 200 }); } catch {} };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready); else ready();
  window.EncoreNative = { platform, share: (d) => navigator.share(d), haptic, go };
})();
