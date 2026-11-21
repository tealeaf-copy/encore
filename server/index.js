// Entry point: load .env, open the store, start HTTP and the daily PM job.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");

// Load .env without overriding variables already set (works on any Node 20).
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv(path.join(ROOT, ".env"));

const { openStore } = await import("./db.js");
const { createApp } = await import("./app.js");
const { schedulePm } = await import("./pm.js");
const { aiMode } = await import("./ai.js");
const { configured } = await import("./integrations/index.js");

const dataDir = path.resolve(ROOT, process.env.DATA_DIR || "data");
const dbFile = process.env.DB_FILE ? path.resolve(ROOT, process.env.DB_FILE) : path.join(dataDir, "encore.db");
const store = openStore(dbFile);
const app = createApp({ store, dataDir });
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

if (!process.env.APP_PASSWORD) console.warn("Warning: APP_PASSWORD is not set, so anyone who can reach this server can read and change all data. Set it before sharing guest links.");
const server = app.listen(port, host, () => {
  console.log(`[encore] http://localhost:${port}  ai=${aiMode()}  integrations=[${configured().map((s) => s.server).join(", ")}]  auth=${process.env.APP_PASSWORD ? "on" : "off"}`);
});
const pmTask = schedulePm(store);

function shutdown() {
  pmTask?.stop?.();
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
