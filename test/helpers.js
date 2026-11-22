import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openStore } from "../server/db.js";
import { createApp } from "../server/app.js";

export async function startServer() {
  process.env.ENCORE_FAKE_AI = "1";
  for (const k of ["SLACK_BOT_TOKEN", "SLACK_WEBHOOK_URL", "LINEAR_API_KEY", "LINEAR_TEAM_ID", "APP_PASSWORD", "HUBSPOT_TOKEN", "SF_INSTANCE_URL", "SF_ACCESS_TOKEN", "SF_CLIENT_ID", "SF_CLIENT_SECRET"]) delete process.env[k];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "encore-test-"));
  const store = openStore(path.join(dir, "test.db"));
  const app = createApp({ store, dataDir: dir });
  const server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, store, dir,
    async close() {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Read an SSE response, calling onEvent(obj) per data event; stop when it returns true. */
export async function readSse(res, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
      if (!data) continue;
      if (await onEvent(JSON.parse(data))) { await reader.cancel(); return; }
    }
  }
}
