// Renders the share-preview cards (1200x630 PNG) that /e/<id> links use when an event has no photo of its own:
// one per illustration, in the same line-art style as event covers. Re-run after changing eventart.js:
//   node scripts/make-og.cjs
const { chromium } = require("playwright"), fs = require("fs"), path = require("path");
const art = fs.readFileSync(path.join(__dirname, "../public/eventart.js"), "utf8"), out = path.join(__dirname, "../public/og");
(async () => { const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
  await p.setContent(`<!doctype html><html><head><style>html,body{margin:0}body{width:1200px;height:630px;display:grid;place-items:center;font-family:system-ui}
.c{position:relative;width:1200px;height:630px;display:grid;place-items:center;overflow:hidden}.c svg{width:620px;height:auto}
.logo{position:absolute;left:44px;bottom:36px;display:flex;align-items:center;gap:12px;font:700 34px/1 system-ui;color:#1F1A17;letter-spacing:-.01em}</style></head><body><div class="c" id="c"></div><script>${art}</script></body></html>`);
  const kinds = await p.evaluate(() => window.EventArt.KINDS.filter((k) => !["pin", "compass", "home", "new", "gather", "sport", "food", "cafe", "climb", "museum", "tour"].includes(k)));
  const pot = `<svg viewBox="0 0 28 28" width="40" height="40" style="width:40px"><path d="M10.2 3.2h7.6v1.9c0 1.3-1.1 1.9-1.1 3.3 0 1.5 5.6 3.4 5.6 9.4 0 4.6-3.7 7.4-8.3 7.4s-8.3-2.8-8.3-7.4c0-6 5.6-7.9 5.6-9.4 0-1.4-1.1-2-1.1-3.3z" fill="#C4532F" stroke="#1F1A17" stroke-width="1.6" stroke-linejoin="round"/><path d="M7.4 16.7c2 1.3 4.3-.9 6.8.2 2.4 1 4.5-.8 6.6.1" fill="none" stroke="#F2D48F" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  for (const k of kinds) { await p.evaluate(([k, pot]) => { const E = window.EventArt, tone = E.toneOf({}, k), bg = E.PASTELS[tone]; const c = document.getElementById("c"); c.style.background = bg; c.innerHTML = E.drawing(k, getComputedStyle(document.body).color && ({ butter: "#F2A71B", blush: "#E8452C", sky: "#2F6FE0", mint: "#1F9D5A", lilac: "#7A4FD6", peach: "#E8452C", sand: "#E8452C" })[tone]) + `<div class="logo">${pot}pottery lab</div>`; }, [k, pot]);
    await p.screenshot({ path: path.join(out, k + ".png"), type: "png" }); }
  console.log(`wrote ${kinds.length} cards to public/og/`); await b.close(); })();
