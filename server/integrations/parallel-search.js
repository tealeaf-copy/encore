// "Parallel Search": web search and page reading, done by Claude's server-side
// web tools in a small separate request. Available whenever AI is configured.
import { aiMode, complete, isFake } from "../ai.js";

const DIGEST = "Write a concise factual digest (plain text, short bullet points are fine). " +
  "For every fact give the source URL and the publication or update date when known. " +
  "Say plainly if you could not find anything reliable.";

function serverToolErrors(content) {
  const errs = [];
  for (const b of content) {
    const c = b?.content;
    if ((b.type === "web_search_tool_result" || b.type === "web_fetch_tool_result") && c && !Array.isArray(c) && /error/.test(c.type || "")) {
      errs.push(c.error_code || "unknown_error");
    }
  }
  return errs;
}

async function run(kind, input) {
  if (isFake()) {
    const what = kind === "search" ? input.query : input.url;
    return `Offline demo result for ${kind === "search" ? "search" : "page"} "${what}". No web request was made (ENCORE_FAKE_AI=1).`;
  }
  const tools = kind === "search"
    ? [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }]
    : [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 }];
  const prompt = kind === "search"
    ? `Search the web for: ${input.query}\n\n${DIGEST}`
    : `Read this page: ${input.url}\n\nSummarise what it says. ${DIGEST}`;
  const { text, content } = await complete({ prompt, effort: "low", tools });
  // Server-tool failures come back as result blocks, not exceptions.
  const errs = serverToolErrors(content);
  if (!text.trim()) {
    throw { code: "tool_error", message: errs.length ? `Web ${kind} failed: ${errs.join(", ")}` : `Web ${kind} returned nothing.` };
  }
  return errs.length ? `${text}\n\n(Some web requests failed: ${errs.join(", ")})` : text;
}

export default function parallelSearch() {
  if (aiMode() === "missing_key") return null;
  return {
    server: "Parallel Search",
    tools: [
      {
        name: "web_search",
        description: "Search the live web and return a short digest of findings with source URLs and dates.",
        inputSchema: { type: "object", properties: { query: { type: "string", description: "What to search for" } }, required: ["query"] },
        run: (input) => {
          if (!input?.query || typeof input.query !== "string") throw { code: "tool_error", message: "query is required" };
          return run("search", input);
        },
      },
      {
        name: "web_fetch",
        description: "Read a web page by URL and return a short digest of its contents.",
        inputSchema: { type: "object", properties: { url: { type: "string", description: "Absolute http(s) URL" } }, required: ["url"] },
        run: (input) => {
          if (!/^https?:\/\//i.test(input?.url || "")) throw { code: "tool_error", message: "url must be an absolute http(s) URL" };
          return run("fetch", input);
        },
      },
    ],
  };
}
