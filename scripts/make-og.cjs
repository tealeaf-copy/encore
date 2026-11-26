// Renders the share-preview cards (1200x630 PNG) that /e/<id> links use when an event has no photo of its own:
// one per illustration, in the same line-art style as event covers, with the line mark and wordmark. Re-run after
// changing eventart.js or the brand colours:
//   node scripts/make-og.cjs
const { chromium } = require("playwright"), fs = require("fs"), path = require("path");
const art = fs.readFileSync(path.join(__dirname, "../public/eventart.js"), "utf8"), out = path.join(__dirname, "../public/og");
(async () => { const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
  await p.setContent(`<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap" rel="stylesheet"><style>html,body{margin:0}body{width:1200px;height:630px;display:grid;place-items:center;font-family:system-ui}
.c{position:relative;width:1200px;height:630px;display:grid;place-items:center;overflow:hidden}.c svg{width:620px;height:auto}
.logo{position:absolute;left:44px;bottom:36px;display:flex;align-items:center;gap:10px;font:400 40px/1 'Instrument Serif',Georgia,serif;color:#1D1B18;letter-spacing:-.01em}.logo svg{width:40px!important;height:40px}</style></head><body><div class="c" id="c"></div><span class="logo" style="opacity:0">pottery lab</span><script>${art}</script></body></html>`);
  await p.evaluate(() => document.fonts.ready);
  const kinds = await p.evaluate(() => window.EventArt.KINDS.filter((k) => !["pin", "compass", "home", "new", "gather", "sport", "food", "cafe", "climb", "museum", "tour"].includes(k)));
  const pot = `<svg viewBox="0 0 28 28"><path d="M10 4.2h8M11.1 4.2v1.7c0 1.2-.9 1.8-.9 2.9 0 1.3-5.5 3.2-5.5 8.9 0 4.5 4.1 7.3 9.3 7.3s9.3-2.8 9.3-7.3c0-5.7-5.5-7.6-5.5-8.9 0-1.1-.9-1.7-.9-2.9V4.2" fill="none" stroke="#1D1B18" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="11.3" cy="16.4" r="1.05" fill="#1D1B18"/><circle cx="16.7" cy="16.4" r="1.05" fill="#1D1B18"/><path d="M12.7 19.2c.8.55 1.8.55 2.6 0" fill="none" stroke="#1D1B18" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  for (const k of kinds) { await p.evaluate(([k, pot]) => { const E = window.EventArt, tone = E.toneOf({}, k), bg = E.PASTELS[tone]; const c = document.getElementById("c"); c.style.background = bg; c.innerHTML = E.drawing(k, E.SPOT[tone]) + `<div class="logo">${pot}pottery lab</div>`; }, [k, pot]);
    await p.screenshot({ path: path.join(out, k + ".png"), type: "png" }); }
  console.log(`wrote ${kinds.length} cards to public/og/`); await b.close(); })();
