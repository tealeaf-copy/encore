import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { cleanSvg } from "../server/art.js";

test("Drawings are rebuilt from safe shapes only: scripts, events, links, styles and foreign tags never survive", () => {
  const evil = `Here you go <svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><style>*{}</style><a href="javascript:alert(1)"><circle cx="5" cy="5" r="3" fill="#fff" onclick="x()" stroke="url(javascript:1)"/></a><foreignObject><div>hi</div></foreignObject><image href="https://evil.example/x.png"/><path d="M0 0L10 10" stroke="#151515" stroke-width="4.5" style="fill:red"/><rect x="1" y="1" width="2" height="2" fill="expression(alert(1))"/><g transform="translate(5 5) scale(2)"><ellipse cx="1" cy="1" rx="2" ry="1" fill="#E8452C"/></g></svg> done`;
  const out = cleanSvg(evil);
  assert.match(out, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 200 150">/);
  for (const bad of ["script", "onload", "onclick", "javascript", "style", "foreignObject", "image", "href", "expression", "<a", "alert"]) assert.ok(!out.includes(bad), `"${bad}" survived: ${out}`);
  assert.ok(out.includes('<circle cx="5" cy="5" r="3" fill="#fff"/>') && out.includes('d="M0 0L10 10"') && out.includes('<g transform="translate(5 5) scale(2)"><ellipse'));
  assert.equal(cleanSvg("no drawing here"), ""); assert.equal(cleanSvg("<svg><text>hi</text></svg>"), "", "nothing drawable");
});

let srv;
const J = { "content-type": "application/json" };
before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "art-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_FAKE_AI = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_AI"]) delete process.env[k]; await srv.close(); });

test("A signed-in host can draw a cover from a prompt; empty prompts and signed-out calls are refused", async () => {
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Ari Art", email: "ari.art@example.com", password: "long-password-1", mode: "friends" }) }); const c = r.headers.get("set-cookie").split(";")[0];
  const draw = (body, cookie) => fetch(srv.base + "/api/art/draw", { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  assert.equal((await draw({ prompt: "a turkey in running shoes" })).status, 401);
  assert.equal((await draw({ prompt: "x" }, c)).status, 400);
  const j = await (await draw({ prompt: "a turkey in running shoes", accent: "#2F6FE0" }, c)).json();
  assert.match(j.svg, /^<svg xmlns/); assert.ok(j.svg.includes("#2F6FE0"), "uses the cover's spot colour"); assert.equal(typeof j.left, "number");
});
