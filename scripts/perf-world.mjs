// A local server seeded with a realistic world, for scripts/perf.mjs and scripts/loadtest.mjs (and by hand:
// `node scripts/perf-world.mjs 4555` serves it until Ctrl-C and prints the host's cookie).
// The world is test/routes-seed.js plus a month of the host's events and a busier group chat.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openStore } from "../server/db.js";
import { createApp } from "../server/app.js";
import { seedRoutes } from "../test/routes-seed.js";

export async function startWorld({ port = 0 } = {}) {
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: process.env.SESSION_SECRET || "perf-secret-0123456789abcdef0123", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_PUSH: "1", ENCORE_FAKE_AI: "1", ENCORE_SIGNUP_PER_HOUR: "5000", ENCORE_VERIFY_EMAIL: "0" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "encore-perf-")), store = openStore(path.join(dir, "perf.db"));
  const app = createApp({ store, dataDir: dir }), server = await new Promise((r) => { const s = app.listen(port, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const S = await seedRoutes(base);
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10), J = { "content-type": "application/json", cookie: S.host.cookie };
  const kinds = [["Dumpling night", "🥟", "dinner"], ["Sunday run club", "🏃", "run"], ["Board game evening", "🎲", "games"], ["Pottery for beginners", "🏺", "class"], ["Rooftop supper", "🍝", "dinner"], ["Book swap", "📚", "books"]];
  for (let i = 0; i < 30; i++) { const [name, emoji, activity] = kinds[i % kinds.length];
    await fetch(`${base}/api/db/doc?path=events/pf${i}`, { method: "PUT", headers: J, body: JSON.stringify({ kind: "social", casual: true, activity, name: `${name} #${i + 1}`, emoji, city: "Brooklyn", meetPoint: "Bed-Stuy", date: day(1 + i), startTime: "19:00", headcount: 10, published: true, discoverable: true, unlisted: false, ...(i % 3 === 0 ? { coverPhoto: S.cover } : {}), desc: "Come hungry. We cook together and eat at one long table, and everyone leaves with leftovers." }) }); }
  for (let i = 0; i < 25; i++) await fetch(`${base}/api/chats/${S.open}/messages`, { method: "POST", headers: J, body: JSON.stringify({ text: `Message ${i + 1}: who's bringing the chili crisp?` }) });
  const close = () => { server.closeAllConnections?.(); server.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { base, S, server, store, close };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const W = await startWorld({ port: +process.argv[2] || 4555 });
  console.log(JSON.stringify({ base: W.base, host: W.S.host.cookie, guest: W.S.guest.cookie, open: W.S.open, handle: W.S.handle }));
  process.on("SIGINT", () => { W.close(); process.exit(0); });
}
