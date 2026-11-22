// Per-request CRM credentials: a workspace's own connection (POST /api/connections) is put here for the
// duration of a tool call, so integrations use it instead of this server's env token.
import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage();
/** Run fn with these provider tokens, e.g. { hubspot: "pat-..." }. Inside, env tokens are only used when allowEnv is true. */
export const withCrm = (tokens, allowEnv, fn) => als.run({ tokens: tokens || {}, allowEnv: !!allowEnv }, fn);
/** The token to use for a provider: the workspace's, else the env fallback (outside a workspace context, or when allowed). */
export function crmToken(provider, envValue) {
  const c = als.getStore();
  if (!c) return envValue;
  return c.tokens[provider] || (c.allowEnv ? envValue : undefined);
}
