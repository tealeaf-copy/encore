// The editor and the Guest view must show the same cover: same background, same colours in the drawing, for every look.
// The invite paints the drawing on the look's cover tone with the look's accent (public/slots.css, public/looks.js); the
// editor used to keep the drawing's own pastel and blue, so Edit and Guest view disagreed and hosts stopped trusting it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";

let srv, cookie;
before(async () => { Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "egm-secret", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_FAKE_EMAIL: "1" }); srv = await startServer();
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Madison", email: "madison.egm@example.com", password: "long-password-1", mode: "friends" }) });
  assert.equal(r.status, 200); cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

const PROBE = `(() => { const c = document.querySelector("#cvCover .ea-cover, .cov .ea-cover"); if (!c) return null; const box = c.closest("#cvCover, .cov");
  return { bg: getComputedStyle(c).backgroundColor, box: getComputedStyle(box).backgroundColor, fills: [...new Set([...c.querySelectorAll(".ea-art svg [fill]")].map((n) => getComputedStyle(n).fill))].sort() }; })()`;

test("Edit and Guest view draw the same cover for the house look, a light look and a dark look", { timeout: 240000 }, async (t) => {
  let chromium, devices; try { ({ chromium, devices } = createRequire(import.meta.url)("playwright")); } catch { return t.skip("no browser"); }
  const br = await chromium.launch(); try { const ctx = await br.newContext({ ...devices["iPhone 13"] });
    await ctx.addCookies(cookie.split("; ").map((c) => { const [n, ...v] = c.split("="); return { name: n, value: v.join("="), url: srv.base }; }));
    const p = await ctx.newPage();
    for (const look of ["House", "Bone", "Forest", "Espresso"]) {
      await p.goto(srv.base + "/?app=1", { waitUntil: "load" }); await p.waitForFunction(() => window.EventCanvas?.open); await p.waitForTimeout(800);
      await p.evaluate(() => window.EventCanvas.open({ mode: "new" })); await p.waitForSelector("#cv #cvTitle");
      await p.locator("#cv").getByRole("button", { name: /Look/ }).last().click();
      await p.locator(".cv-sh button", { hasText: new RegExp("^\\s*" + look + "\\s*$") }).first().click(); await p.locator(".cv-sh [data-done]").first().click(); await p.waitForTimeout(600);
      const edit = await p.evaluate(PROBE); assert.ok(edit, look + ": the editor has a drawn cover");
      await p.click('#cv [data-mode="guest"]'); await p.waitForFunction(() => [...document.querySelectorAll("iframe")].some((f) => { try { return f.contentDocument?.querySelector(".cov .ea-cover"); } catch { return false; } }), null, { timeout: 20000 }); await p.waitForTimeout(700);
      const guest = await p.frames().find((f) => /_preview/.test(f.url())).evaluate(PROBE);
      assert.deepEqual(edit, guest, look + ": the cover in Edit is the cover in Guest view");
    } } finally { await br.close(); }
});
