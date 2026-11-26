// App icons and launch screens: Potto's line mark (the logo in public/favicon.svg and the nav) in ink on bone, the
// brand colours in docs/brand-kit.md. The full Potto (public/mascot.js) is kept for moments, not for the icon.
//   public/icons/   web manifest icons (any + maskable, which Android uses for adaptive icons), apple-touch-icon, favicon,
//                   iOS home-screen launch images (splash-*.png), and the 1024 App Store icon (no transparency)
//   mobile/resources/  the source images @capacitor/assets turns into the iOS and Android icon sets and splash screens
// Re-run after changing the mark or the palette:   node scripts/make-app-icons.cjs
const { chromium } = require("playwright"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const BONE = "#F4F0E8", INK = "#1D1B18";
// the line mark, the same drawing as public/favicon.svg and the nav logo, cropped to its own box
const MARK = (c) => `<svg viewBox="3 2.6 22 23" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><path d="M10 4.2h8M11.1 4.2v1.7c0 1.2-.9 1.8-.9 2.9 0 1.3-5.5 3.2-5.5 8.9 0 4.5 4.1 7.3 9.3 7.3s9.3-2.8 9.3-7.3c0-5.7-5.5-7.6-5.5-8.9 0-1.1-.9-1.7-.9-2.9V4.2" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="11.3" cy="16.4" r="1.05" fill="${c}"/><circle cx="16.7" cy="16.4" r="1.05" fill="${c}"/><path d="M12.7 19.2c.8.55 1.8.55 2.6 0" fill="none" stroke="${c}" stroke-width="1.3" stroke-linecap="round"/></svg>`;
// iOS launch images: [width, height, device-width, device-height, pixel ratio] in portrait
const SPLASH = [[1320, 2868, 440, 956, 3], [1290, 2796, 430, 932, 3], [1206, 2622, 402, 874, 3], [1179, 2556, 393, 852, 3], [1170, 2532, 390, 844, 3], [1284, 2778, 428, 926, 3], [1125, 2436, 375, 812, 3], [750, 1334, 375, 667, 2], [1640, 2360, 820, 1180, 2], [2048, 2732, 1024, 1366, 2]];
const out = (...p) => { const f = path.join(root, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ deviceScaleFactor: 1 }); const p = await ctx.newPage();
  await p.setContent(`<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap" rel="stylesheet"><style>html,body{margin:0;background:transparent}#c{display:grid;place-items:center;overflow:hidden}
#c svg{display:block}.w{font:400 64px/1 'Instrument Serif',Georgia,serif;letter-spacing:-.01em;margin-top:3vh}</style></head><body><div id="c"></div><span class="w" style="position:absolute;opacity:0">pottery lab</span></body></html>`);
  await p.evaluate(() => document.fonts.ready);
  // one picture: a w x h box on bg (or transparent), the mark at `scale` of the shorter side, optional word mark under it
  async function shot(file, w, h, { bg = BONE, scale = 0.58, word = false, ink = INK, dy = 0 } = {}) {
    await p.setViewportSize({ width: w, height: h });
    await p.evaluate(([w, h, bg, scale, word, svg, ink, dy]) => { const c = document.getElementById("c"), s = Math.round(Math.min(w, h) * scale);
      c.style.cssText = `width:${w}px;height:${h}px;background:${bg || "transparent"}`;
      c.innerHTML = `<div style="display:grid;justify-items:center;transform:translateY(${Math.round(dy * h)}px)"><div style="width:${s}px;height:${s}px">${svg}</div>${word ? `<div class="w" style="font-size:${Math.round(s * 0.36)}px;color:${ink}">pottery lab</div>` : ""}</div>`; }, [w, h, bg, scale, word, MARK(ink), ink, dy]);
    await p.screenshot({ path: file, type: "png", omitBackground: !bg, clip: { x: 0, y: 0, width: w, height: h } });
  }
  // web manifest + iOS
  for (const s of [48, 72, 96, 128, 144, 152, 192, 256, 384, 512]) await shot(out("public/icons", `icon-${s}.png`), s, s);
  for (const s of [192, 512]) await shot(out("public/icons", `maskable-${s}.png`), s, s, { scale: 0.46 }); // inside the 80% safe circle
  await shot(out("public/icons", "monochrome-512.png"), 512, 512, { bg: null, scale: 0.56 });
  await shot(out("public/icons", "apple-touch-icon.png"), 180, 180);
  await shot(out("public/icons", "favicon-32.png"), 32, 32, { scale: 0.84 });
  await shot(out("public/icons", "icon-1024.png"), 1024, 1024); // App Store Connect: 1024, opaque
  for (const [w, h] of SPLASH) await shot(out("public/icons", `splash-${w}x${h}.png`), w, h, { scale: 0.2, word: true, dy: -0.02 });
  // Capacitor sources (npx @capacitor/assets generate): icon-only, adaptive foreground/background, splash light and dark
  await shot(out("mobile/resources", "icon-only.png"), 1024, 1024);
  await shot(out("mobile/resources", "icon-foreground.png"), 1024, 1024, { bg: null, scale: 0.42 }); // Android adaptive: 66% safe zone
  await shot(out("mobile/resources", "icon-background.png"), 1024, 1024, { scale: 0.0001 });
  await shot(out("mobile/resources", "splash.png"), 2732, 2732, { scale: 0.14, word: true, dy: -0.01 });
  await shot(out("mobile/resources", "splash-dark.png"), 2732, 2732, { bg: INK, ink: BONE, scale: 0.14, dy: -0.01 });
  fs.writeFileSync(out("public/icons", "splash.json"), JSON.stringify(SPLASH.map(([w, h, dw, dh, r]) => ({ src: `/icons/splash-${w}x${h}.png`, dw, dh, r })), null, 1) + "\n");
  // the App Store refuses an icon with an alpha channel, even a fully opaque one: flatten (ImageMagick)
  for (const f of ["public/icons/icon-1024.png", "mobile/resources/icon-only.png", "public/icons/apple-touch-icon.png"]) { try { require("child_process").execFileSync("convert", [path.join(root, f), "-background", BONE, "-alpha", "remove", "-alpha", "off", path.join(root, f)]); } catch { console.warn("install ImageMagick to flatten " + f); } }
  console.log("wrote icons to public/icons/ and mobile/resources/"); await b.close();
})();
