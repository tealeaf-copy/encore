// Registry of server-side integrations, exposed to the page as "mcp" connectors.
// Configuration is read at call time so env changes in tests take effect.
import parallelSearch from "./parallel-search.js";
import slack from "./slack.js";
import linear from "./linear.js";
import hubspot from "./hubspot.js";
import salesforce from "./salesforce.js";
import gong from "./gong.js";

const factories = [parallelSearch, slack, linear, hubspot, salesforce];

export function configured() {
  return factories.map((f) => f()).filter(Boolean);
}
export { withCrm } from "./context.js";
/**
 * The integrations a workspace may use. The default workspace: everything configured on this server. Other
 * workspaces: shared web search only. Either way, a provider the workspace connected itself (POST /api/connections)
 * is listed and runs on that workspace's credentials (see context.js).
 */
const OWN = { hubspot: ["HubSpot", hubspot], salesforce: ["Salesforce - Beta", salesforce], slack: ["Slack", slack], linear: ["Linear", linear], gong: ["Gong", gong] };
export function configuredFor({ isDefault, connected = {} }) {
  let base = configured().filter((x) => isDefault || x.server === "Parallel Search");
  for (const [provider, [name, factory]] of Object.entries(OWN)) {
    if (!connected[provider]) continue;
    base = base.filter((x) => x.server !== name);
    base.push(factory({ force: true }));
  }
  return base;
}

export function findServer(name, servers = configured()) {
  const s = servers.find((x) => x.server === name);
  if (!s) throw { code: "server_not_connected", message: `"${name}" is not connected on this server.` };
  return s;
}

/** Call a tool; resolves {content:[{type:"text",text}], payload}. */
export async function callTool(serverName, toolName, input, servers) {
  const s = findServer(serverName, servers);
  const t = s.tools.find((x) => x.name === toolName);
  if (!t) throw { code: "tool_not_found", message: `"${serverName}" has no tool "${toolName}".` };
  let payload;
  try {
    payload = await t.run(input && typeof input === "object" ? input : {});
  } catch (err) {
    throw { code: err?.code || "tool_error", message: String(err?.message || err) };
  }
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return { content: [{ type: "text", text }], payload };
}
