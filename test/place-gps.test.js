// "Use my location" (public/place.js): a tap always uses the phone's answer, far away offers the closest cities,
// and each way it can fail says what happened.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const SRC = fs.readFileSync(new URL("../public/place.js", import.meta.url), "utf8");
function load({ geo, secure = true, store = {} } = {}) {
  const mem = { ...store }, localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const window = { isSecureContext: secure, localStorage }, navigator = geo === undefined ? {} : { geolocation: geo };
  const ctx = { window, navigator, localStorage, document: { addEventListener() {} }, setTimeout, clearTimeout, console };
  vm.createContext(ctx); vm.runInContext(SRC, ctx);
  return { P: window.EncorePlace, mem };
}
const at = (lat, lng) => ({ getCurrentPosition: (ok) => ok({ coords: { latitude: lat, longitude: lng } }) });
const err = (code) => ({ getCurrentPosition: (_ok, bad) => bad({ code }) });

test("a tap on Use my location overrides a stale manual choice", async () => {
  const stale = JSON.stringify({ city: "Austin", source: "manual", gpsCity: "San Francisco" });
  const { P } = load({ geo: at(37.78, -122.41), store: { "encore.place": stale } });
  const r = await P.useGps();
  assert.equal(r.ok, true); assert.equal(r.city, "San Francisco");
  assert.equal(P.get().city, "San Francisco"); assert.equal(P.get().source, "gps");
  // resolve({ prompt: true }) is an explicit ask too: the GPS answer wins over the manual one
  const { P: P2 } = load({ geo: at(37.78, -122.41), store: { "encore.place": stale } });
  const p = await P2.resolve({ prompt: true });
  assert.equal(p.city, "San Francisco"); assert.equal(p.source, "gps");
});

test("far from every city we know: the three closest, nearest first", async () => {
  const { P } = load({ geo: at(44.5, -110.5) }); // Yellowstone
  const r = await P.useGps();
  assert.equal(r.ok, false); assert.equal(r.code, "far");
  assert.match(r.message, /don't have your area yet/);
  assert.equal(r.closest.length, 3); assert.ok(r.closest.includes("Denver"), r.closest.join());
  assert.equal(P.get(), null, "nothing saved until they pick");
  // a town 200 miles out still counts as the nearest city
  const { P: P3 } = load({ geo: at(39.2, -120.0) }); // Lake Tahoe
  assert.equal((await P3.useGps()).city, "San Francisco");
});

test("each failure says what happened", async () => {
  const cases = [[1, "denied", /Settings, Privacy & Security, Location Services/], [3, "timeout", /took too long/], [2, "unavailable", /couldn't find a location/]];
  for (const [code, name, re] of cases) { const r = await load({ geo: err(code) }).P.useGps(); assert.equal(r.code, name); assert.match(r.message, re); }
  const none = await load({}).P.useGps(); assert.equal(none.code, "unsupported"); assert.match(none.message, /can't share your location/);
  const insecure = await load({ geo: at(37.78, -122.41), secure: false }).P.useGps(); assert.equal(insecure.code, "insecure");
});

test("one coarse try with a 15s timeout and a few minutes of cache", async () => {
  let opts = null, calls = 0; const geo = { getCurrentPosition: (_ok, bad, o) => { calls++; opts = o; bad({ code: 3 }); } };
  const r = await load({ geo }).P.useGps();
  assert.equal(r.code, "timeout"); assert.equal(calls, 1, "no automatic high-accuracy retry");
  assert.equal(opts.timeout, 15000); assert.equal(opts.enableHighAccuracy, false); assert.ok(opts.maximumAge >= 60e3 && opts.maximumAge <= 10 * 60e3);
});
