import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "./helpers.js";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { delete process.env.ENCORE_CANONICAL_HOST; await srv.close(); });
// a request as if it came in on another domain (fetch can't set Host)
const get = (path, host, method = "GET") => new Promise((ok, no) => { const u = new URL(srv.base); const r = http.request({ host: u.hostname, port: u.port, path, method, headers: { host } }, (res) => { res.resume(); ok({ status: res.statusCode, location: res.headers.location || "" }); }); r.on("error", no); r.end(); });

test("Moving to potterylab.ai: pages on the old address forward there, keeping the path; APIs and localhost don't", async () => {
  delete process.env.ENCORE_CANONICAL_HOST;
  assert.notEqual((await get("/hosts", "encore-2qzx.onrender.com")).status, 301, "nothing moves until the new address is set");
  process.env.ENCORE_CANONICAL_HOST = "potterylab.ai";
  const r = await get("/@atbo?ref=ig", "encore-2qzx.onrender.com"); assert.equal(r.status, 301); assert.equal(r.location, "https://potterylab.ai/@atbo?ref=ig");
  assert.equal((await get("/g", "www.potterylab.ai")).location, "https://potterylab.ai/g", "www goes to the bare domain");
  assert.notEqual((await get("/hosts", "potterylab.ai")).status, 301, "already there");
  assert.notEqual((await get("/api/public/discover", "encore-2qzx.onrender.com")).status, 301, "API calls aren't redirected");
  assert.notEqual((await get("/hosts", "localhost")).status, 301);
});
