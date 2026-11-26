/* Pottery Lab browser shim: implements the claude.ai artifact capabilities the page
 * uses (window.claude.use(name)) against this server. Loaded before the page's
 * own script, so window.claude exists synchronously. */
window.ENCORE_SERVER = true; // tells the page it runs on this server (guest links use location.origin)
// Who's signed in (named team members only), so approvals and the audit log record a real person.
if (!/^#(rsvp-|survey-|nominate-|plan-|roadmap|guests-|approve-)/.test(location.hash || "")) {
  fetch("/api/me", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((m) => {
    if (!m?.verified) return;
    window.ENCORE_ME = m;
    if (typeof window.renderStep === "function" && location.hash === "#studio") window.renderStep();
  }).catch(() => {});
}
(function () {
  "use strict";

  const isGuest = () => /^#(rsvp-|survey-|nominate-|plan-|roadmap|guests-|approve-|signoff-|confnom)/.test(location.hash || "");
  const capError = (code, message, extra) => Object.assign({ code, message }, extra || {});

  // a create sent twice within 10 seconds with the same content (autosave racing the Save button, a double tap, a retry
  // after a dropped answer) carries the same Idempotency-Key, so the server makes one (server/perf.js)
  const IDEM_COLLECTIONS = /^(events|rsvps|kudos|orders)$/, idemKeys = new Map();
  const idemKey = (path, body) => { const s = path + JSON.stringify(body, (k, v) => (/^(createdAt|updatedAt|_base)$/.test(k) ? undefined : v)); let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    const now = Date.now(), k = idemKeys.get(h); if (k && now - k.at < 10000) return k.key; for (const [x, v] of idemKeys) if (now - v.at > 10000) idemKeys.delete(x); const key = "c-" + (h >>> 0).toString(36) + "-" + now.toString(36); idemKeys.set(h, { at: now, key }); return key; };
  const guestKey = () => { try { let k = localStorage.getItem("encore.gkey"); if (!k) { k = randomId().slice(0, 32); localStorage.setItem("encore.gkey", k); } return k; } catch { return ""; } };
  async function api(method, url, body, { raw = false, headers = {} } = {}) {
    const h = { ...headers };
    if (isGuest()) { const wsq = /[?&]ws=([A-Za-z0-9_-]+)/.exec(location.search) || /~ws-([A-Za-z0-9_-]+)/.exec(location.hash || ""); if (wsq) window.__encoreWs = wsq[1]; if (window.__encoreWs) h["x-encore-workspace"] = window.__encoreWs; h["x-encore-guest"] = "1"; h["x-encore-key"] = guestKey(); h["x-encore-view"] = (/^#([a-z]+)/.exec(location.hash || "") || [])[1] || ""; const inv = /\.i-([A-Za-z0-9_-]+)~([a-f0-9]+)$/.exec(location.hash || ""); if (inv) { try { const k = decodeURIComponent(escape(atob(inv[1].replace(/-/g, "+").replace(/_/g, "/")))); h["x-encore-invite"] = encodeURIComponent(k) + "~" + inv[2]; } catch {} } else { const t = /~([a-f0-9]+)$/.exec(location.hash || ""); if (t) h["x-encore-token"] = t[1]; } }
    let payload = body;
    if (body !== undefined && !raw) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    let res;
    try {
      res = await fetch(url, { method, headers: h, body: payload, credentials: "same-origin" });
    } catch (e) {
      throw capError("network_error", "Can't reach the Pottery Lab server.");
    }
    let data = null;
    try { data = await res.json(); } catch {}
    if (res.ok && isGuest() && data && typeof data === "object" && data.workspace && !window.__encoreWs) window.__encoreWs = String(data.workspace);
    if (!res.ok) {
      const code = data?.code || (res.status === 429 ? "rate_limited" : res.status === 401 || res.status === 403 ? "not_granted" : "upstream_error");
      throw capError(code, data?.message || `Request failed (${res.status})`, { status: res.status });
    }
    return data;
  }

  // ---------------------------------------------------------------- sample
  function parseJsonLoose(text) {
    const t = String(text ?? "").trim();
    try { return JSON.parse(t); } catch {}
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) { try { return JSON.parse(fence[1].trim()); } catch {} }
    const starts = [t.indexOf("{"), t.indexOf("[")].filter((i) => i >= 0);
    if (starts.length) {
      const s = Math.min(...starts);
      const e = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
      if (e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch {} }
    }
    throw capError("invalid_json", "The reply was not valid JSON.", { text: t });
  }

  async function runTool(tools, runId, ev) {
    const tool = tools.find((t) => t.name === ev.name);
    let content, isError = false;
    try {
      if (!tool || typeof tool.execute !== "function") throw new Error(`Unknown tool ${ev.name}`);
      const out = await tool.execute(ev.input || {});
      content = typeof out === "string" ? out : JSON.stringify(out === undefined ? null : out);
    } catch (e) {
      isError = true;
      content = String(e?.message || e?.code || e || "Tool failed");
    }
    try {
      await api("POST", `/api/ai/${encodeURIComponent(runId)}/tool-result`, { id: ev.id, content, is_error: isError });
    } catch (e) { /* the run will time the tool out */ }
  }

  async function sample(input, opts) {
    opts = opts || {};
    const tools = Array.isArray(opts.tools) ? opts.tools : [];
    const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
    if (isGuest()) headers["x-encore-guest"] = "1";
    let res;
    try {
      res = await fetch("/api/ai", {
        method: "POST",
        headers,
        credentials: "same-origin",
        signal: opts.signal,
        body: JSON.stringify({
          input,
          modelTier: opts.modelTier || "default",
          ...(typeof opts.purpose === "string" ? { purpose: opts.purpose.slice(0, 32) } : {}), // "event_read": the server rate-limits Potto's reads on their own
          tools: tools.map((t) => ({ name: t.name, description: t.description || "", inputSchema: t.inputSchema || { type: "object", properties: {} } })),
        }),
      });
    } catch (e) {
      throw capError("upstream_error", "Can't reach the Pottery Lab server.");
    }
    if (!res.ok || !res.body) {
      let d = null; try { d = await res.json(); } catch {}
      throw capError(d?.code || (res.status === 429 ? "rate_limited" : res.status === 401 || res.status === 403 ? "not_granted" : "upstream_error"), d?.message || `AI request failed (${res.status})`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", text = "", runId = null;
    const toolRuns = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
        if (!data) continue;
        let ev; try { ev = JSON.parse(data); } catch { continue; }
        if (ev.type === "run") runId = ev.runId;
        else if (ev.type === "text") {
          text += ev.delta || "";
          try { opts.onText && opts.onText({ text, delta: ev.delta || "" }); } catch (e) { console.error(e); }
        } else if (ev.type === "tool_call") toolRuns.push(runTool(tools, runId, ev));
        else if (ev.type === "done") { try { reader.cancel(); } catch {} return { text: ev.text ?? text, truncated: false }; }
        else if (ev.type === "error") { try { reader.cancel(); } catch {} throw capError(ev.code || "upstream_error", ev.message || "AI request failed"); }
      }
    }
    throw capError("upstream_error", "The AI stream ended unexpectedly.");
  }
  sample.json = async function (input, opts) {
    const r = await sample(input, opts);
    return parseJsonLoose(r.text);
  };
  sample.limits = async function () { return {}; };

  // ---------------------------------------------------------------- db
  const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  function randomId() {
    const a = new Uint8Array(20); crypto.getRandomValues(a);
    return Array.from(a, (b) => ID_CHARS[b % ID_CHARS.length]).join("");
  }
  const enc = encodeURIComponent;
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

  function docSnap(id, exists, data, ref) {
    return { id, exists, ref, data: () => (exists ? clone(data) : undefined), get: (f) => (exists ? getField(data, f) : undefined) };
  }
  function getField(obj, field) {
    return String(field).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  // One shared EventSource for every subscription.
  const subs = new Set();
  let es = null;
  function ensureEvents() {
    if (es || typeof EventSource === "undefined" || isGuest()) return;
    let opened = false;
    es = new EventSource("/api/db/events");
    es.onopen = () => {
      // After a reconnect we may have missed writes: refresh everything.
      if (opened) subs.forEach((s) => s.refresh());
      opened = true;
    };
    es.onmessage = (m) => {
      let e; try { e = JSON.parse(m.data); } catch { return; }
      if (!e.path) return;
      subs.forEach((s) => { if (s.matches(e)) s.refresh(); });
    };
  }

  function subscribe({ matches, load, next, error }) {
    let timer = null, active = true, inflight = false, again = false;
    const run = async () => {
      if (!active) return;
      if (inflight) { again = true; return; }
      inflight = true;
      try { const snap = await load(); if (active) next(snap); }
      catch (e) { if (active && typeof error === "function") error(e); else if (active && !/unauthenticated|Sign in first/i.test(String(e?.code || e?.message || ""))) console.warn("[encore] snapshot failed", e); }
      finally { inflight = false; if (again) { again = false; run(); } }
    };
    const sub = { matches, refresh() { clearTimeout(timer); timer = setTimeout(run, 30); } };
    subs.add(sub);
    ensureEvents();
    run();
    return () => { active = false; clearTimeout(timer); subs.delete(sub); };
  }

  function docRef(path) {
    const id = path.split("/").pop();
    const ref = {
      id, path,
      async get() {
        const d = await api("GET", `/api/db/doc?path=${enc(path)}`);
        return docSnap(id, !!d.exists, d.data, ref);
      },
      async set(obj) { await api("PUT", `/api/db/doc?path=${enc(path)}`, clone(obj)); },
      async update(partial) { await api("PATCH", `/api/db/doc?path=${enc(path)}`, clone(partial)); },
      async delete() { await api("DELETE", `/api/db/doc?path=${enc(path)}`); },
      collection(sub) { return collectionRef(`${path}/${sub}`); },
      onSnapshot(next, error) {
        return subscribe({ matches: (e) => e.path === path, load: () => ref.get(), next, error });
      },
    };
    return ref;
  }

  function compare(a, op, b) {
    switch (op) {
      case "==": return JSON.stringify(a) === JSON.stringify(b);
      case "!=": return JSON.stringify(a) !== JSON.stringify(b);
      case "<": return a < b;
      case "<=": return a <= b;
      case ">": return a > b;
      case ">=": return a >= b;
      case "in": return Array.isArray(b) && b.some((x) => JSON.stringify(x) === JSON.stringify(a));
      case "not-in": return Array.isArray(b) && !b.some((x) => JSON.stringify(x) === JSON.stringify(a));
      case "array-contains": return Array.isArray(a) && a.some((x) => JSON.stringify(x) === JSON.stringify(b));
      case "array-contains-any": return Array.isArray(a) && Array.isArray(b) && a.some((x) => b.some((y) => JSON.stringify(x) === JSON.stringify(y)));
      default: return false;
    }
  }

  function makeQuery(path, spec) {
    const load = async () => {
      const evw = spec.where.find((w) => w.field === "eventId" && w.op === "==");
      const r = await api("GET", `/api/db/collection?path=${enc(path)}${evw ? `&eventId=${enc(evw.value)}` : ""}`);
      let rows = r.docs || [];
      for (const w of spec.where) rows = rows.filter((d) => compare(getField(d.data, w.field), w.op, w.value));
      for (const o of [...spec.orderBy].reverse()) {
        const dir = o.dir === "desc" ? -1 : 1;
        rows = rows.slice().sort((x, y) => {
          const a = getField(x.data, o.field), b = getField(y.data, o.field);
          return a === b ? 0 : a == null ? -dir : b == null ? dir : a < b ? -dir : dir;
        });
      }
      if (spec.limit != null) rows = rows.slice(0, spec.limit);
      const docs = rows.map((d) => docSnap(d.id, true, d.data, docRef(`${path}/${d.id}`)));
      return { docs, size: docs.length, empty: docs.length === 0, docChanges: () => [], forEach: (fn) => docs.forEach(fn) };
    };
    const q = {
      where: (field, op, value) => makeQuery(path, { ...spec, where: [...spec.where, { field, op, value }] }),
      orderBy: (field, dir) => makeQuery(path, { ...spec, orderBy: [...spec.orderBy, { field, dir: dir || "asc" }] }),
      limit: (n) => makeQuery(path, { ...spec, limit: n }),
      get: load,
      onSnapshot: (next, error) => subscribe({ matches: (e) => e.parent === path, load, next, error }),
    };
    return q;
  }

  function collectionRef(path) {
    const q = makeQuery(path, { where: [], orderBy: [], limit: null });
    return {
      ...q,
      path,
      id: path.split("/").pop(),
      doc: (id) => docRef(`${path}/${id || randomId()}`),
      async add(obj) {
        const body = clone(obj), r = await api("POST", `/api/db/collection?path=${enc(path)}`, body, { headers: IDEM_COLLECTIONS.test(path) ? { "Idempotency-Key": idemKey(path, body) } : {} });
        const ref = docRef(`${path}/${r.id}`); if (r.response) ref.response = r.response; return ref;
      },
    };
  }
  const db = { doc: docRef, collection: collectionRef };

  // ---------------------------------------------------------------- mcp
  let toolCache = null;
  async function loadTools() {
    if (!toolCache) toolCache = api("GET", "/api/mcp/tools").catch((e) => { toolCache = null; throw e; });
    return toolCache;
  }
  const mcp = {
    async listTools(server) {
      const r = await loadTools();
      let servers = r.servers || [];
      if (server) {
        servers = servers.filter((s) => s.server === server);
        if (!servers.length) throw capError("server_not_connected", `"${server}" is not connected.`);
      }
      return { servers: servers.map((s) => ({ server: s.server, authStatus: s.authStatus, tools: s.tools.map((t) => ({ name: t.name, description: t.description })) })) };
    },
    async describeTool(server, tool) {
      const r = await loadTools();
      const s = (r.servers || []).find((x) => x.server === server);
      if (!s) throw capError("server_not_connected", `"${server}" is not connected.`);
      const t = s.tools.find((x) => x.name === tool);
      if (!t) throw capError("tool_not_found", `"${server}" has no tool "${tool}".`);
      return { name: t.name, description: t.description, inputSchema: t.inputSchema };
    },
    callTool(server, tool, input) {
      return api("POST", "/api/mcp/call", { server, tool, input: input || {} });
    },
    async server(name) {
      const r = await loadTools();
      const s = (r.servers || []).find((x) => x.server === name);
      if (!s) throw capError("server_not_connected", `"${name}" is not connected.`);
      const obj = {};
      for (const t of s.tools) obj[t.name] = (input) => mcp.callTool(name, t.name, input);
      return obj;
    },
  };

  // ---------------------------------------------------------------- user
  let uid = null;
  const user = {
    id() {
      if (uid) return uid;
      try { uid = localStorage.getItem("encore.uid"); } catch {}
      if (!uid) {
        uid = "u_" + randomId().slice(0, 16);
        try { localStorage.setItem("encore.uid", uid); } catch {}
      }
      return uid;
    },
    async me() { return { id: user.id(), name: window.ENCORE_ME?.name || "" }; },
    isOwner() { return true; },
    canEdit() { return true; },
    async profiles() { return {}; },
  };

  // ---------------------------------------------------------------- downloads
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data == null ? "" : String(data)], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename || "download"; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return { ok: true };
    },
  };

  // ---------------------------------------------------------------- assets
  const assets = {
    async upload(blob) {
      if (!(blob instanceof Blob)) throw capError("invalid_input", "upload() needs a Blob or File.");
      return api("POST", "/api/assets", blob, { raw: true, headers: { "Content-Type": blob.type || "application/octet-stream" } });
    },
    async list() { return (await api("GET", "/api/assets")).assets; },
    async delete(id) { return api("DELETE", `/api/assets/${enc(id)}`); },
  };

  const namespaces = { sample, db, mcp, user, downloads, assets };
  window.claude = {
    use(name) { return Promise.resolve(Object.prototype.hasOwnProperty.call(namespaces, name) ? namespaces[name] : null); },
  };
})();
