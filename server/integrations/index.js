// Registry of server-side integrations, exposed to the page as "mcp" connectors.
// Configuration is read at call time so env changes in tests take effect.
import parallelSearch from "./parallel-search.js";
import slack from "./slack.js";
import linear from "./linear.js";
import hubspot from "./hubspot.js";
import salesforce from "./salesforce.js";

const factories = [parallelSearch, slack, linear, hubspot, salesforce];

export function configured() {
  return factories.map((f) => f()).filter(Boolean);
}

export function findServer(name) {
  const s = configured().find((x) => x.server === name);
  if (!s) throw { code: "server_not_connected", message: `"${name}" is not connected on this server.` };
  return s;
}

/** Call a tool; resolves {content:[{type:"text",text}], payload}. */
export async function callTool(serverName, toolName, input) {
  const s = findServer(serverName);
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
