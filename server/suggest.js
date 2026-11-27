// Potto's autocomplete on the server (public/autocomplete.js asks here; the bank itself is in server/suggestbank.js).
//
// - POST /api/suggest { text, kind, city } -> { items: [{ text, kind?, place?, day?, time? }], source }
//   Smarter completions for what someone is typing: an event idea, a Watching alert, a question for Potto, a post or a
//   place. Only the typed text, their city and the field kind are read, and only those go into the prompt: never a
//   name, an email or anything about guests. Signed out works too (/start), with a lower limit per IP.
//   source: "potto" (the model, or ENCORE_FAKE_AI=1's rules), "cache", "none" (no key here: the page keeps its own)
//   or "off" (the person turned "Suggestions from Potto" off in Settings).
//   Limits: ENCORE_SUGGEST_PER_MIN (default 30) and ENCORE_SUGGEST_PER_HOUR (default 300) per person, half that per
//   IP signed out; 429 past either. Answers are cached by kind, city and text for 10 minutes.
// - GET /api/public/suggest/places: cities (with nicknames) and neighbourhoods (with their borough), for the page to
//   complete places with no server at all. Cached a day.
// - GET /api/suggest/mine: the titles, kind and city of your own events, for "you hosted" suggestions, and the Settings
//   switch (potto: true or false), so a phone picks up a choice made on a laptop.
import crypto from "node:crypto";
import { complete, aiMode, parseJsonLoose } from "./ai.js";
import { placesPayload } from "./suggestbank.js";

const KINDS = ["idea", "kind", "alert", "ask", "post", "place"];
const PLAN = ["dinner", "drinks", "game", "brunch", "table", "class", "potluck", "picnic", "hack", "book", "run", "hike", "watch", "popup", "drop", "weekend", "summit", "other"];
const lc = (s) => String(s || "").trim().toLowerCase();
const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;
const FIELD = { idea: "an event title or plan", kind: "a short name for a kind of get-together (24 characters at most)", alert: "something they want to be told about when it's posted (Watching)", ask: "a question for Potto", post: "a short post for their friends", place: "where an event happens" };

/** The prompt: the field, the city and the typed text, nothing else about the person. */
export function suggestPrompt({ kind, city, text }) {
  return `POTTO-SUGGEST
You are Potto, the helper inside Pottery Lab, an app for hosting small get-togethers with friends. Talk like a smart, humble, fun friend. Someone is typing into a field and you finish the thought.
<field>${kind}</field>
<what>${FIELD[kind] || FIELD.idea}</what>
<city>${city}</city>
<typed>${text}</typed>
Offer up to 5 completions. Each one starts with exactly what they typed when it can, keeps their words, and adds at most 60 characters. Plain words, specific and warm: a real neighbourhood, park or kind of place in their city is great, so is a day and a time when it fits. No emoji, no em dashes, no real people's names, nothing unsafe.
For each, give the plan kind when one fits (${PLAN.join(", ")}), and the place, the day (sun, mon, tue, wed, thu, fri or sat) and the time (HH:MM, 24 hour) when the words say them.
Reply with only JSON: {"items":[{"text":"","kind":"","place":"","day":"","time":""}]}`;
}
/** What comes back, made safe: 5 at most, short, no emoji or em dashes, only known kinds, days and times. */
export function cleanItems(raw, typed) {
  const L = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : [], seen = new Set([lc(typed)]), out = [];
  for (const x of L) { const text = clean(String(x?.text ?? x ?? "").replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(EMOJI, ""), 90).replace(/\s+([,.!?])/g, "$1"); if (text.length < 2 || seen.has(lc(text))) continue; seen.add(lc(text));
    const it = { text }; if (PLAN.includes(x?.kind)) it.kind = x.kind; const pl = clean(x?.place, 60); if (pl) it.place = pl;
    if (/^(sun|mon|tue|wed|thu|fri|sat)$/.test(x?.day || "")) it.day = x.day; if (/^([01]\d|2[0-3]):[0-5]\d$/.test(x?.time || "")) it.time = x.time; out.push(it); if (out.length >= 5) break; }
  return out;
}

export function mountSuggest(app, { store, small, currentUser, X }) {
  const who = (req) => { let u = null; try { u = currentUser(req); } catch {} return u && u.email ? u : null; };
  const hits = new Map(), cache = new Map(), state = { lastPrompt: "", calls: 0 };
  app.locals.suggest = state;
  const limited = (key, anon) => { const now = Date.now(), H = (hits.get(key) || []).filter((t) => now - t < 3600e3), div = anon ? 2 : 1;
    const perMin = Math.max(1, Math.floor(num(process.env.ENCORE_SUGGEST_PER_MIN, 30) / div)), perHour = Math.max(1, Math.floor(num(process.env.ENCORE_SUGGEST_PER_HOUR, 300) / div));
    if (H.length >= perHour || H.filter((t) => now - t < 60e3).length >= perMin) { hits.set(key, H); return true; } H.push(now); hits.set(key, H); if (hits.size > 20000) hits.clear(); return false; };
  const pottoOff = (u) => { try { return !!u && X?.prefs?.(u.email)?.pottoSuggest === false; } catch { return false; } };

  app.post("/api/suggest", small, async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const b = req.body || {}, u = who(req), kind = KINDS.includes(b.kind) ? b.kind : "idea", text = clean(b.text, 120), city = clean(b.city, 60);
    if (text.length < 3) return res.json({ items: [], source: "none" });
    if (pottoOff(u)) return res.json({ items: [], source: "off" });
    const key = u ? "u:" + hash(u.email) : "ip:" + (req.ip || "?");
    if (limited(key, !u)) return res.status(429).json({ code: "rate_limited", message: "That's a lot of typing. Suggestions from Potto take a short break." });
    const ck = kind + "|" + lc(city) + "|" + lc(text), hit = cache.get(ck);
    if (hit && Date.now() - hit.at < 600e3) return res.json({ items: hit.items, source: "cache" });
    if (aiMode() === "missing_key") return res.json({ items: [], source: "none" });
    const prompt = suggestPrompt({ kind, city, text }); state.lastPrompt = prompt; state.calls++;
    let items = [];
    try { let t = 0; const r = await Promise.race([complete({ prompt, effort: "low" }), new Promise((_, rej) => { t = setTimeout(() => rej({ code: "timeout" }), num(process.env.ENCORE_SUGGEST_TIMEOUT_MS, 6000)); })]).finally(() => clearTimeout(t));
      items = cleanItems(parseJsonLoose(r.text), text); }
    catch (e) { return res.json({ items: [], source: "none" }); } // the page keeps its own; nothing to show here
    if (cache.size > 2000) cache.clear(); cache.set(ck, { at: Date.now(), items });
    res.json({ items, source: "potto" });
  });

  app.get("/api/public/suggest/places", (req, res) => { res.set("Cache-Control", "public, max-age=86400"); res.json(placesPayload()); });

  app.get("/api/suggest/mine", (req, res) => { res.set("Cache-Control", "private, no-store"); const u = who(req); if (!u) return res.json({ events: [], potto: true });
    const em = lc(u.email), out = [], seen = new Set();
    try { const I = X.index(); for (const x of I.events.values()) { if (lc(x.owner) !== em) continue; const e = x.e || {}; if (e.example || e.sample) continue; const t = clean(e.pubTitle || e.name, 90); if (t.length < 3 || seen.has(lc(t))) continue; seen.add(lc(t));
      out.push({ t, k: String(e.planKind || "").slice(0, 20), city: clean(e.city, 60), at: Date.parse(e.date || "") || 0 }); } } catch {}
    out.sort((a, b) => b.at - a.at); res.json({ events: out.slice(0, 40).map(({ at, ...r }) => r), potto: !pottoOff(u) }); });
}
