// App icons and launch screens, drawn from Potto (public/mascot.js) on the brand colors (docs/brand-kit.md):
//   public/icons/   web manifest icons (any + maskable, which Android uses for adaptive icons), apple-touch-icon, favicon,
//                   iOS home-screen launch images (splash-*.png), and the 1024 App Store icon (no transparency)
//   mobile/resources/  the source images @capacitor/assets turns into the iOS and Android icon sets and splash screens
// Re-run after changing mascot.js:   node scripts/make-app-icons.cjs
const { chromium } = require("playwright"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, ".."), mascot = fs.readFileSync(path.join(root, "public/mascot.js"), "utf8");
const BUTTER = "#F2D48F", PAPER = "#F7F1E8", NIGHT = "#15110E";
// iOS launch images: [width, height, device-width, device-height, pixel ratio] in portrait
const SPLASH = [[1320, 2868, 440, 956, 3], [1290, 2796, 430, 932, 3], [1206, 2622, 402, 874, 3], [1179, 2556, 393, 852, 3], [1170, 2532, 390, 844, 3], [1284, 2778, 428, 926, 3], [1125, 2436, 375, 812, 3], [750, 1334, 375, 667, 2], [1640, 2360, 820, 1180, 2], [2048, 2732, 1024, 1366, 2]];
const out = (...p) => { const f = path.join(root, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ deviceScaleFactor: 1 }); const p = await ctx.newPage();
  await p.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}#c{display:grid;place-items:center;overflow:hidden}
#c svg{display:block}.w{font:600 64px/1 Fredoka,"Instrument Sans",system-ui,sans-serif;color:#1F1A17;letter-spacing:-.01em;margin-top:2vh}</style></head><body><div id="c"></div><script>${mascot}</script></body></html>`);
  // one picture: a w x h box on bg (or transparent), Potto at `scale` of the shorter side, optional word mark under him
  async function shot(file, w, h, { bg = BUTTER, scale = 0.74, word = false, pose = "wave", dy = 0.03 } = {}) {
    await p.setViewportSize({ width: w, height: h });
    await p.evaluate(([w, h, bg, scale, word, pose, dy]) => { const c = document.getElementById("c"), s = Math.round(Math.min(w, h) * scale);
      c.style.cssText = `width:${w}px;height:${h}px;background:${bg || "transparent"}`;
      c.innerHTML = `<div style="display:grid;justify-items:center;transform:translateY(${Math.round(dy * h)}px)">${window.Potto.svg(pose, s, "Potto")}${word ? `<div class="w" style="font-size:${Math.round(s * 0.2)}px">pottery lab</div>` : ""}</div>`; }, [w, h, bg, scale, word, pose, dy]);
    await p.screenshot({ path: file, type: "png", omitBackground: !bg, clip: { x: 0, y: 0, width: w, height: h } });
  }
  // web manifest + iOS
  for (const s of [48, 72, 96, 128, 144, 152, 192, 256, 384, 512]) await shot(out("public/icons", `icon-${s}.png`), s, s);
  for (const s of [192, 512]) await shot(out("public/icons", `maskable-${s}.png`), s, s, { scale: 0.56 }); // inside the 80% safe circle
  await shot(out("public/icons", "monochrome-512.png"), 512, 512, { bg: null, scale: 0.6 });
  await shot(out("public/icons", "apple-touch-icon.png"), 180, 180);
  await shot(out("public/icons", "favicon-32.png"), 32, 32, { scale: 0.86 });
  await shot(out("public/icons", "icon-1024.png"), 1024, 1024); // App Store Connect: 1024, opaque
  for (const [w, h] of SPLASH) await shot(out("public/icons", `splash-${w}x${h}.png`), w, h, { bg: PAPER, scale: 0.34, word: true, dy: -0.02 });
  // Capacitor sources (npx @capacitor/assets generate): icon-only, adaptive foreground/background, splash light and dark
  await shot(out("mobile/resources", "icon-only.png"), 1024, 1024);
  await shot(out("mobile/resources", "icon-foreground.png"), 1024, 1024, { bg: null, scale: 0.5 }); // Android adaptive: 66% safe zone
  await shot(out("mobile/resources", "icon-background.png"), 1024, 1024, { bg: BUTTER, scale: 0.0001 });
  await shot(out("mobile/resources", "splash.png"), 2732, 2732, { bg: PAPER, scale: 0.24, word: true, dy: -0.01 });
  await shot(out("mobile/resources", "splash-dark.png"), 2732, 2732, { bg: NIGHT, scale: 0.24, dy: -0.01 });
  fs.writeFileSync(out("public/icons", "splash.json"), JSON.stringify(SPLASH.map(([w, h, dw, dh, r]) => ({ src: `/icons/splash-${w}x${h}.png`, dw, dh, r })), null, 1) + "\n");
  // the App Store refuses an icon with an alpha channel, even a fully opaque one: flatten (ImageMagick)
  for (const f of ["public/icons/icon-1024.png", "mobile/resources/icon-only.png", "public/icons/apple-touch-icon.png"]) { try { require("child_process").execFileSync("convert", [path.join(root, f), "-background", BUTTER, "-alpha", "remove", "-alpha", "off", path.join(root, f)]); } catch { console.warn("install ImageMagick to flatten " + f); } }
  console.log("wrote icons to public/icons/ and mobile/resources/"); await b.close();
})();
