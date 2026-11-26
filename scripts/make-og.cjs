// Renders the share-preview cards (1200x630 PNG) that /e/<id> links use when an event has no photo of its own:
// one per illustration, in the same line-art style as event covers, with the Field Notes mark and wordmark, on linen in an ink frame. Re-run after
// changing eventart.js or the brand colours:
//   node scripts/make-og.cjs
const { chromium } = require("playwright"), fs = require("fs"), path = require("path");
const art = fs.readFileSync(path.join(__dirname, "../public/eventart.js"), "utf8"), out = path.join(__dirname, "../public/og");
(async () => { const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
  await p.setContent(`<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@600&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet"><style>html,body{margin:0}body{width:1200px;height:630px;display:grid;place-items:center;font-family:system-ui}
.c{position:relative;width:1200px;height:630px;display:grid;place-items:center;overflow:hidden;box-sizing:border-box;border:6px solid #1B1D1C}.c svg{width:620px;height:auto}
.logo{position:absolute;left:44px;bottom:36px;display:flex;align-items:center;gap:10px;font:600 40px/1 'IBM Plex Sans',system-ui,sans-serif;color:#1B1D1C;letter-spacing:-.03em}.logo svg{width:40px!important;height:40px}</style></head><body><div class="c" id="c"></div><span class="logo" style="opacity:0">pottery lab</span><script>${art}</script></body></html>`);
  await p.evaluate(() => document.fonts.ready);
  const kinds = await p.evaluate(() => window.EventArt.KINDS.filter((k) => !["pin", "compass", "home", "new", "gather", "sport", "food", "cafe", "climb", "museum", "tour"].includes(k)));
  const pot = `<svg viewBox="0 0 48 48"><rect x="1.5" y="1.5" width="45" height="45" rx="6" fill="none" stroke="#1B1D1C" stroke-width="2.5"/><path d="M17 11h14M19 11v4l-6 6v9a7 7 0 0 0 7 7h8a7 7 0 0 0 7-7v-9l-6-6v-4" fill="none" stroke="#1B1D1C" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="20.5" cy="26" r="1.9" fill="#29489A"/><circle cx="27.5" cy="26" r="1.9" fill="#29489A"/></svg>`;
  for (const k of kinds) { await p.evaluate(([k, pot]) => { const E = window.EventArt, tone = E.toneOf({}, k), bg = E.PASTELS[tone]; const c = document.getElementById("c"); c.style.background = bg; c.innerHTML = E.drawing(k, E.SPOT[tone]) + `<div class="logo">${pot}pottery lab</div>`; }, [k, pot]);
    await p.screenshot({ path: path.join(out, k + ".png"), type: "png" }); }
  console.log(`wrote ${kinds.length} cards to public/og/`); await b.close(); })();
