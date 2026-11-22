// Slack: bot token (Web API) or, failing that, an incoming webhook (send only).
// A workspace's own bot token and default channel (POST /api/connections) win over the env settings.
import { crmToken } from "./context.js";

const API = "https://slack.com/api/";
const botToken = () => crmToken("slack", process.env.SLACK_BOT_TOKEN);
const defaultChannel = () => crmToken("slack-channel", process.env.SLACK_DEFAULT_CHANNEL);
const webhook = () => crmToken("slack-webhook", process.env.SLACK_WEBHOOK_URL);

async function slackApi(method, body, { get = false } = {}) {
  const token = botToken();
  const url = new URL(API + method);
  const init = { headers: { Authorization: `Bearer ${token}` } };
  if (get) {
    for (const [k, v] of Object.entries(body || {})) url.searchParams.set(k, v);
  } else {
    init.method = "POST";
    init.headers["Content-Type"] = "application/json; charset=utf-8";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (!res.ok) throw { code: "tool_error", message: `Slack ${method} HTTP ${res.status}` };
  const json = await res.json();
  if (!json.ok) throw { code: "tool_error", message: `Slack ${method}: ${json.error || "failed"}` };
  return json;
}

async function sendMessage(input) {
  const text = String(input?.text || "").trim();
  if (!text) throw { code: "tool_error", message: "text is required" };
  if (botToken()) {
    let channel = input.channel || defaultChannel();
    if (input.user_email) {
      const u = await slackApi("users.lookupByEmail", { email: input.user_email }, { get: true });
      channel = u.user.id; // posting to a user id opens a DM from the bot
    }
    if (!channel) throw { code: "tool_error", message: "No channel: pass channel or user_email, or set a default channel for Slack." };
    const r = await slackApi("chat.postMessage", { channel, text });
    return { ok: true, channel: r.channel, ts: r.ts };
  }
  if (!webhook()) throw { code: "tool_error", message: "Slack isn't connected." };
  const res = await fetch(webhook(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw { code: "tool_error", message: `Slack webhook HTTP ${res.status}` };
  return { ok: true, via: "webhook" };
}

async function searchUsers(input) {
  const query = String(input?.query || "").trim().toLowerCase();
  if (!query) throw { code: "tool_error", message: "query is required" };
  const out = [];
  let cursor = "";
  for (let page = 0; page < 10 && out.length < 20; page++) {
    const r = await slackApi("users.list", { limit: "200", ...(cursor ? { cursor } : {}) }, { get: true });
    for (const m of r.members || []) {
      if (m.deleted || m.is_bot) continue;
      const p = m.profile || {};
      const hay = [m.name, m.real_name, p.display_name, p.real_name, p.email].filter(Boolean).join(" ").toLowerCase();
      if (hay.includes(query)) out.push({ id: m.id, name: p.real_name || m.real_name || m.name, displayName: p.display_name || "", email: p.email || "" });
    }
    cursor = r.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  return { users: out.slice(0, 20) };
}

/** force: a workspace connected its own bot token, so list the bot tools without env settings. */
export default function slack({ force = false } = {}) {
  const bot = force || !!process.env.SLACK_BOT_TOKEN;
  const hook = !!process.env.SLACK_WEBHOOK_URL;
  if (!bot && !hook) return null;
  const tools = [{
    name: "slack_send_message",
    description: bot
      ? "Send a Slack message to a channel (id or #name) or, with user_email, as a DM to that person."
      : "Send a Slack message to the team's configured channel.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        ...(bot ? { channel: { type: "string", description: "Channel id or name" }, user_email: { type: "string", description: "DM this person instead" } } : {}),
      },
      required: ["text"],
    },
    run: sendMessage,
  }];
  if (bot) tools.push({
    name: "slack_search_users",
    description: "Find Slack users by name or email.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: searchUsers,
  });
  return { server: "Slack", tools };
}
