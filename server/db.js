// Firestore-like document store on SQLite: one row per document.
// Paths alternate collection/doc: "events/abc", "brands/main", "events/abc/notes/n1".
import Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SEGMENT = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;

/** Returns segments or throws {status:400}. kind: "doc" | "collection". */
export function parsePath(p, kind) {
  if (typeof p !== "string" || !p) throw httpError(400, "bad_path", "Missing path.");
  const segs = p.split("/");
  for (const s of segs) {
    if (!SEGMENT.test(s) || s === "." || s === "..") throw httpError(400, "bad_path", `Invalid path segment in "${p.slice(0, 80)}".`);
  }
  const isDoc = segs.length % 2 === 0;
  if (kind === "doc" && !isDoc) throw httpError(400, "bad_path", "A document path needs an even number of segments (collection/doc).");
  if (kind === "collection" && isDoc) throw httpError(400, "bad_path", "A collection path needs an odd number of segments.");
  return segs;
}

export function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export function randomId() {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(20);
  let id = "";
  for (const b of bytes) id += abc[b % abc.length];
  return id;
}

export function openStore(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  // a second connection (a backup, the sqlite3 shell, a second process during a deploy) waits up to 5s for a lock
  // instead of failing the request with SQLITE_BUSY
  db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS docs (
    path TEXT PRIMARY KEY,
    parent TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS docs_parent ON docs(parent);`);

  const q = {
    get: db.prepare("SELECT id, data, updated FROM docs WHERE path = ?"),
    put: db.prepare(`INSERT INTO docs (path, parent, id, data, updated) VALUES (@path, @parent, @id, @data, @updated)
      ON CONFLICT(path) DO UPDATE SET data = excluded.data, updated = excluded.updated`),
    del: db.prepare("DELETE FROM docs WHERE path = ?"),
    list: db.prepare("SELECT id, data, updated FROM docs WHERE parent = ? ORDER BY id"),
    // a range on the primary key, so "system/ws-..." reads only workspaces, not every inbox and pref beside them
    listP: db.prepare("SELECT id, data, updated FROM docs WHERE path >= ? AND path < ? AND parent = ? ORDER BY path"),
    dumpP: db.prepare("SELECT path, data, updated FROM docs WHERE substr(path, 1, ?) = ? ORDER BY path"),
    delP: db.prepare("DELETE FROM docs WHERE substr(path, 1, ?) = ?"),
  };
  const events = new EventEmitter();
  events.setMaxListeners(0);

  const split = (p) => {
    const segs = parsePath(p, "doc");
    return { parent: segs.slice(0, -1).join("/"), id: segs[segs.length - 1] };
  };
  // Reads of a whole collection are cached until a write to that collection (or a prefix delete): an invite or the
  // feed lists the same collection many times per request (each event's guests, its host's kit), and under load the
  // SELECT and JSON.parse of every row was most of the server's time. ver: writes per collection; epoch: prefix deletes.
  const ver = new Map(), rowsCache = new Map(), sharedCache = new Map(); let epoch = 0;
  const bump = (parent) => ver.set(parent, (ver.get(parent) || 0) + 1);
  const fresh = (C, k) => { const c = C.get(k); return c && c.v === (ver.get(k) || 0) && c.e === epoch ? c : null; };
  const keep = (C, k, val) => { if (C.size > 400) C.clear(); C.set(k, { v: ver.get(k) || 0, e: epoch, val }); return val; };
  const rowsOf = (collection) => fresh(rowsCache, collection)?.val || keep(rowsCache, collection, q.list.all(collection));
  const notify = (p, parent) => { bump(parent); events.emit("change", { path: p, parent }); };
  const asObject = (v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw httpError(400, "bad_data", "Document data must be a JSON object.");
    return v;
  };

  const store = {
    events,
    get(p) {
      split(p);
      const row = q.get.get(p);
      return row ? { id: row.id, data: JSON.parse(row.data), updated: row.updated } : null;
    },
    set(p, data) {
      const { parent, id } = split(p);
      q.put.run({ path: p, parent, id, data: JSON.stringify(asObject(data)), updated: Date.now() });
      notify(p, parent);
      return { id };
    },
    update(p, partial) {
      const { parent, id } = split(p);
      asObject(partial);
      const tx = db.transaction(() => {
        const row = q.get.get(p);
        if (!row) throw httpError(404, "not_found", "No document to update at " + p);
        const merged = { ...JSON.parse(row.data), ...partial };
        q.put.run({ path: p, parent, id, data: JSON.stringify(merged), updated: Date.now() });
        return merged;
      });
      const merged = tx();
      notify(p, parent);
      return { id, data: merged };
    },
    delete(p) {
      const { parent } = split(p);
      const r = q.del.run(p);
      if (r.changes) notify(p, parent);
      return { deleted: r.changes > 0 };
    },
    add(collection, data) {
      parsePath(collection, "collection");
      const id = randomId();
      store.set(`${collection}/${id}`, data);
      return { id, path: `${collection}/${id}` };
    },
    /** Every document under a path prefix (for workspace export). */
    dumpPrefix(prefix) { return q.dumpP.all(prefix.length, prefix).map((r) => ({ path: r.path, data: JSON.parse(r.data), updated: r.updated })); },
    /** Delete every document under a path prefix (for workspace deletion). Returns how many. */
    deletePrefix(prefix) { epoch++; return q.delP.run(prefix.length, prefix).changes; },
    list(collection) {
      parsePath(collection, "collection");
      return rowsOf(collection).map((r) => ({ id: r.id, data: JSON.parse(r.data), updated: r.updated }));
    },
    /** list(), parsed once and shared until the collection changes. Read only: never change what it returns. */
    listShared(collection) {
      parsePath(collection, "collection");
      return fresh(sharedCache, collection)?.val || keep(sharedCache, collection, rowsOf(collection).map((r) => ({ id: r.id, data: JSON.parse(r.data), updated: r.updated })));
    },
    /** The documents of one collection whose ids start with idPrefix ("system", "ws-" → every workspace). */
    listPrefix(collection, idPrefix) {
      parsePath(collection, "collection");
      const lo = `${collection}/${String(idPrefix || "")}`; // path segments are ASCII, so U+FFFF sorts after all of them
      return q.listP.all(lo, lo + "\uffff", collection).map((r) => ({ id: r.id, data: JSON.parse(r.data), updated: r.updated }));
    },
    close() { db.close(); },
  };
  return store;
}
