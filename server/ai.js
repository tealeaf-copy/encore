// Claude access for Pottery Lab. The API key stays on the server: the SDK's default
// constructor reads ANTHROPIC_API_KEY from the environment. Never log it.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";
export const MAX_TOKENS = 32000;
export const MAX_ITERATIONS = 24;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const EFFORT = { quick: "low", default: "medium", complex: "high" };

export function isFake() {
  return process.env.ENCORE_FAKE_AI === "1";
}
export function aiMode() {
  if (isFake()) return "fake";
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? "live" : "missing_key";
}
export function effortFor(tier) {
  return EFFORT[tier] || "medium";
}

let client = null;
export function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

// Refusal fallbacks are on by default. If the API rejects the combination with
// a 400, we retry that request once without it and stop sending it afterwards.
let fallbacksSupported = true;

/** Map any thrown error to the capability error shape {code, message}. */
export function toCapError(err) {
  if (err && typeof err === "object" && typeof err.code === "string" && !(err instanceof Anthropic.APIError)) {
    return { code: err.code, message: String(err.message || err.code) };
  }
  if (err instanceof Anthropic.RateLimitError) return { code: "rate_limited", message: "Claude is rate limited. Try again in a moment." };
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { code: "not_granted", message: "The server's Claude API key was rejected." };
  }
  if (err instanceof Anthropic.APIError) {
    return { code: "upstream_error", message: `Claude API error${err.status ? " " + err.status : ""}: ${safeMessage(err)}` };
  }
  return { code: "upstream_error", message: safeMessage(err) };
}
function safeMessage(err) {
  const m = String(err?.message || err || "unknown error");
  // Belt and braces: never echo anything that looks like a key.
  return m.replace(/sk-ant-[A-Za-z0-9_\-]+/g, "[redacted]").slice(0, 500);
}

function missingKeyError() {
  return { code: "not_granted", message: "No ANTHROPIC_API_KEY is configured on the server." };
}

/**
 * Open one streamed beta Messages request, with refusal fallbacks when supported.
 * Returns the final message. `onText` gets text deltas. `signal` aborts.
 */
async function streamOnce(params, { onText, signal } = {}) {
  const c = getClient();
  const attempt = async (withFallbacks) => {
    const body = { ...params };
    if (withFallbacks) {
      body.betas = [FALLBACK_BETA];
      body.fallbacks = "default";
    }
    const stream = c.beta.messages.stream(body, signal ? { signal } : undefined);
    if (onText) stream.on("text", (delta) => onText(delta));
    return await stream.finalMessage();
  };
  if (fallbacksSupported) {
    try {
      return await attempt(true);
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError) {
        console.warn("[ai] request with refusal fallbacks got a 400; retrying once without them");
        const msg = await attempt(false);
        fallbacksSupported = false; // the plain request worked, so the 400 was the fallback combination
        return msg;
      }
      throw err;
    }
  }
  return await attempt(false);
}

/**
 * After a mid-output fallback, blocks before the last `fallback` block that are
 * model-internal (thinking, redacted_thinking, tool_use, unpaired server_tool_use)
 * must not be echoed back. Everything else is kept, including the fallback block.
 */
export function sanitizeForEcho(content) {
  const last = content.map((b) => b.type).lastIndexOf("fallback");
  if (last < 0) return content;
  const resultIds = new Set(content.filter((b) => b.tool_use_id).map((b) => b.tool_use_id));
  return content.filter((b, i) => {
    if (i >= last) return true;
    if (b.type === "thinking" || b.type === "redacted_thinking" || b.type === "tool_use") return false;
    if (b.type === "server_tool_use") return resultIds.has(b.id);
    return true;
  });
}

const textOf = (content) => content.filter((b) => b.type === "text").map((b) => b.text).join("");

/** Normalise the page's sample() input to Messages API messages. */
export function toMessages(input) {
  if (typeof input === "string") {
    if (!input.trim()) throw { code: "invalid_input", message: "Prompt is empty." };
    return [{ role: "user", content: input }];
  }
  if (!Array.isArray(input) || !input.length) throw { code: "invalid_input", message: "Input must be a string or a non-empty message list." };
  const msgs = input.map((m) => {
    if (!m || (m.role !== "user" && m.role !== "assistant")) throw { code: "invalid_input", message: "Each message needs role user or assistant." };
    const content = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content : String(m.content ?? "");
    return { role: m.role, content };
  });
  if (msgs[0].role !== "user" || msgs[msgs.length - 1].role !== "user") {
    throw { code: "invalid_input", message: "Messages must start and end on a user turn." };
  }
  return msgs;
}

function validateToolInput(input, schema) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  for (const k of schema?.required || []) if (!(k in input)) return false;
  return true;
}

/**
 * Run the manual agentic loop (streaming). Page tools run in the browser:
 * `callTool({id, name, input})` must resolve `{content, is_error}`.
 * `emit(event)` receives {type:"text", delta}. Resolves with the final answer text.
 */
export async function runToolLoop({ input, modelTier, tools = [], emit, callTool, signal }) {
  const messages = toMessages(input);
  if (isFake()) return fakeLoop({ messages, tools, emit, callTool });
  if (aiMode() === "missing_key") throw missingKeyError();

  const apiTools = tools.map((t) => ({
    name: t.name,
    description: t.description || "",
    input_schema: t.inputSchema && typeof t.inputSchema === "object" ? { type: "object", ...t.inputSchema } : { type: "object", properties: {} },
    eager_input_streaming: true,
  }));
  const schemas = new Map(tools.map((t) => [t.name, t.inputSchema]));
  let answer = "";
  let jsonRetries = 0;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const params = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: effortFor(modelTier) },
      messages,
      ...(apiTools.length ? { tools: apiTools } : {}),
    };
    let message;
    try {
      message = await streamOnce(params, { onText: (delta) => emit({ type: "text", delta }), signal });
      jsonRetries = 0;
    } catch (err) {
      if (signal?.aborted) throw { code: "aborted", message: "Client disconnected." };
      // Unparseable eager tool input or a dropped connection: re-issue the turn.
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      console.warn("[ai] tool input unparseable or connection dropped, re-issuing the turn");
      continue;
    }

    const content = sanitizeForEcho(message.content);
    const turnText = textOf(content);

    if (message.stop_reason === "end_turn" || message.stop_reason === "stop_sequence") return answer + turnText;
    if (message.stop_reason === "refusal") {
      throw { code: "refused", message: message.stop_details?.explanation || "Claude declined this request." };
    }
    if (message.stop_reason === "pause_turn") {
      answer += turnText;
      messages.push({ role: "assistant", content });
      continue;
    }
    const toolUses = content.filter((b) => b.type === "tool_use");
    if (message.stop_reason === "max_tokens") {
      throw { code: "upstream_error", message: "Claude hit the output limit before finishing." };
    }
    if (message.stop_reason !== "tool_use" || !toolUses.length) return answer + turnText;

    messages.push({ role: "assistant", content });
    // Run every requested tool, then send all results in ONE user message.
    const results = await Promise.all(
      toolUses.map(async (tu) => {
        if (!validateToolInput(tu.input, schemas.get(tu.name))) {
          return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: JSON.stringify({ INVALID_JSON: JSON.stringify(tu.input) }) };
        }
        const r = await callTool({ id: tu.id, name: tu.name, input: tu.input });
        return { type: "tool_result", tool_use_id: tu.id, content: String(r.content ?? ""), ...(r.is_error ? { is_error: true } : {}) };
      }),
    );
    messages.push({ role: "user", content: results });
    answer = ""; // the answer is what comes after the last tool round
  }
  throw { code: "upstream_error", message: `Stopped after ${MAX_ITERATIONS} model turns without a final answer.` };
}

/**
 * One-shot server-side request (PM job, web search digest). Handles pause_turn
 * for server tools. Returns {text, content} with text from every turn.
 */
export async function complete({ prompt, effort = "low", tools, maxIterations = 8 }) {
  if (isFake()) return { text: fakeText(prompt), content: [] };
  if (aiMode() === "missing_key") throw missingKeyError();
  const messages = [{ role: "user", content: prompt }];
  let text = "";
  const all = [];
  for (let i = 0; i < maxIterations; i++) {
    const message = await streamOnce({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort },
      messages,
      ...(tools ? { tools } : {}),
    });
    const content = sanitizeForEcho(message.content);
    all.push(...content);
    text += textOf(content);
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content });
      continue;
    }
    if (message.stop_reason === "refusal") throw { code: "refused", message: message.stop_details?.explanation || "Claude declined this request." };
    if (message.stop_reason === "max_tokens") throw { code: "upstream_error", message: "Claude hit the output limit before finishing." };
    return { text, content: all };
  }
  return { text, content: all };
}

// ---------- JSON parsing (same tolerance as the shim's sample.json) ----------
export function parseJsonLoose(text) {
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
  throw { code: "invalid_json", message: "Reply was not valid JSON.", text: t };
}

// ---------- Fake mode: deterministic, no network ----------
function lastUserText(messages) {
  const m = messages[messages.length - 1];
  return typeof m.content === "string" ? m.content : JSON.stringify(m.content);
}
export function fakeText(prompt) {
  const p = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
  if (/"nudges"/.test(p)) {
    return JSON.stringify({
      nudges: [{ to: "Owner", message: "Friendly reminder: a task on your list is due soon. Can you take a look today?" }],
      risks: [{ risk: "Some tasks are behind schedule", fix: "Check in with owners this week" }],
      askYou: "",
    });
  }
  if (/^POTTO-EVENT-READ\b/.test(p)) return JSON.stringify(fakeEventRead(p));
  if (/Reply with only JSON/i.test(p)) return JSON.stringify({ ok: true });
  return "This is a demo reply from Pottery Lab's offline mode (ENCORE_FAKE_AI=1). No AI was called.";
}
// Potto's event read (index.html prAiPrompt) in offline mode: a small, deterministic reading of the host's message, so
// tests and demos run the page's merge without a key. It only fills what a few plain rules see (an am/pm time, a price
// and its unit, spots, ask to join, the book pick, a distance); everything else is null, so the page's regex reading stands.
export const EVENT_READ_KEYS = ["title", "kind", "date", "startTime", "endTime", "repeat", "weekdays", "monthly", "sessions", "repeatUntil", "place", "meetPoint", "hood", "city", "price", "priceUnit", "groupSize", "passPrice", "passCount", "dropIn", "costNote", "free", "payWhatYouLike", "headcount", "approvalRequired", "preorder", "orderItems", "orderDeadline", "stock", "bring", "notes", "description"];
export function fakeEventRead(prompt) {
  const s = (String(prompt).match(/<message>\n?([\s\S]*?)\n?<\/message>/) || [])[1] || "";
  const o = Object.fromEntries(EVENT_READ_KEYS.map((k) => [k, null]));
  const clock = (h, m, ap) => { h = +h % 12 + (ap.toLowerCase() === "pm" ? 12 : 0); return `${String(h).padStart(2, "0")}:${m || "00"}`; };
  const rg = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const one = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (rg) { o.startTime = clock(rg[1], rg[2], rg[3] || rg[6]); o.endTime = clock(rg[4], rg[5], rg[6]); } else if (one) o.startTime = clock(one[1], one[2], one[3]);
  const tot = s.match(/\$\s?(\d{1,5})\s*(?:total|for (?:it )?all\b(?!\s*\d)|for the (?:whole |full )?(?:course|series))/i);
  const drop = s.match(/\$\s?(\d{1,5})\s*(?:(?:a|per)\s+)?(?:class\s*)?drop[- ]?in/i);
  const each = s.match(/\$\s?(\d{1,5})(?:\s*(a person|per person|pp|each|a class|per class))?/i);
  if (tot) { o.price = +tot[1]; o.priceUnit = "total"; if (drop && +drop[1] !== +tot[1]) o.dropIn = +drop[1]; }
  else if (each && !/food cost|cost\b/i.test(s.slice(each.index, each.index + 30))) { o.price = +each[1]; o.priceUnit = /each/i.test(each[2] || "") ? "each" : /class/i.test(each[2] || "") ? "class" : "person"; }
  if (/\bfree\b|\$0\b/i.test(s) && !o.price) o.free = true;
  const hc = s.match(/\b(\d{1,3})\s*(?:spots|seats|people|guests|max)\b/i); if (hc) o.headcount = +hc[1];
  if (/\b(?:ask|request)\s+(?:to|2)\s+join\b|\bi(?:'ll| will)?\s+(?:pick|choose|approve)\s+who\b|\bapprove guests\b|\binvite[- ]only\b/i.test(s)) o.approvalRequired = true;
  const notes = [];
  const bk = s.match(/\bthis month\s*(?::|is)\s*([^,;!?\n]+)/i); if (bk) notes.push(`This month: ${bk[1].trim()}`);
  const dist = s.match(/\b\d{1,3}(?:\s*-\s*\d{1,3})?\s*(?:miles?|mi|km|k)\b/i); if (dist) notes.push(dist[0]);
  if (notes.length) o.notes = notes;
  return o;
}
async function fakeLoop({ messages, tools, emit, callTool }) {
  const prompt = lastUserText(messages);
  if (tools.length) {
    const r = await callTool({ id: "fake_tool_1", name: tools[0].name, input: {} });
    if (r.is_error) console.log(`[ai:fake] tool ${tools[0].name} returned an error result`);
  }
  const text = fakeText(prompt);
  const mid = Math.ceil(text.length / 2);
  emit({ type: "text", delta: text.slice(0, mid) });
  emit({ type: "text", delta: text.slice(mid) });
  return text;
}
