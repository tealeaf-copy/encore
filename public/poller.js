// One shared poller for every page (chats, the chat badge in the nav, the inbox): a single timer instead of one
// setInterval per feature, and the same manners everywhere.
//   PLPoll.every(key, fn, { ms = 30000, max = 5 * 60000, hidden = "pause", now = false }) -> { stop(), kick(), next() }
//   - one task per key (asking again replaces the old one), so a view that mounts twice never polls twice
//   - fn may return a promise; a task never overlaps itself
//   - a failure (a throw or a rejected promise) doubles the wait, up to max; the next success goes back to ms
//   - fn may return a number: the wait in ms before its next run (a chat that's gone quiet slows itself down)
//   - while the tab is hidden: "pause" (the default) stops the task, a number waits at least that long; when the tab
//     shows again, every task that was due runs at once
//   - the browser going offline pauses everything; coming back online runs what's due
(function (root) {
  if (root.PLPoll) return;
  const T = new Map(); let timer = 0, nextAt = Infinity;
  const hiddenNow = () => typeof document !== "undefined" && document.hidden;
  const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
  const now = () => Date.now();
  function plan() {
    clearTimeout(timer); timer = 0; nextAt = Infinity;
    for (const t of T.values()) if (!t.busy) nextAt = Math.min(nextAt, t.due);
    if (nextAt === Infinity) return;
    timer = setTimeout(tick, Math.max(0, Math.min(nextAt - now(), 2 ** 31 - 1)));
  }
  function waitOf(t) { const base = t.override ?? t.ms * 2 ** t.fails; const w = Math.min(t.max, Math.max(250, base)); return hiddenNow() && typeof t.hidden === "number" ? Math.max(w, t.hidden) : w; }
  async function run(t) {
    if (t.busy || t.stopped) return; t.busy = true; t.override = null;
    try { const r = await t.fn(); t.fails = 0; if (typeof r === "number" && r > 0) t.override = r; }
    catch { t.fails = Math.min(t.fails + 1, 10); }
    finally { t.busy = false; if (!t.stopped) { t.due = now() + waitOf(t); } plan(); }
  }
  function tick() {
    timer = 0; const at = now();
    for (const t of [...T.values()]) {
      if (t.busy || t.due > at) continue;
      if (offline() || (hiddenNow() && t.hidden === "pause")) { t.due = Infinity; t.waiting = true; continue; }
      run(t);
    }
    plan();
  }
  function wake() { const at = now(); for (const t of T.values()) if (t.waiting || t.due === Infinity) { t.waiting = false; t.due = at; } tick(); }
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (!hiddenNow()) wake(); });
  if (typeof addEventListener === "function") { addEventListener("online", wake); addEventListener("pageshow", (e) => { if (e.persisted) wake(); }); }
  function every(key, fn, o = {}) {
    T.get(key)?.stop();
    const t = { key, fn, ms: Math.max(250, +o.ms || 30000), max: Math.max(250, +o.max || 5 * 60000), hidden: o.hidden ?? "pause", fails: 0, busy: false, stopped: false, override: null, waiting: false, due: now() };
    t.due = o.now ? now() : now() + t.ms;
    t.stop = () => { t.stopped = true; if (T.get(key) === t) T.delete(key); plan(); };
    T.set(key, t); plan();
    return { stop: t.stop, kick: () => { if (t.stopped) return; t.due = now(); t.fails = 0; tick(); }, next: () => t.due, state: () => ({ fails: t.fails, busy: t.busy, due: t.due }) };
  }
  root.PLPoll = { every, stop: (k) => T.get(k)?.stop(), _tasks: T, _wake: wake };
})(typeof window !== "undefined" ? window : globalThis);
