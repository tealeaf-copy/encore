// Linear: create issues through the GraphQL API. A workspace's own API key and team win over the env settings.
import { crmToken } from "./context.js";

const ENDPOINT = "https://api.linear.app/graphql";

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: crmToken("linear", process.env.LINEAR_API_KEY) },
    body: JSON.stringify({ query, variables }),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok || json?.errors?.length) {
    const msg = json?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw { code: "tool_error", message: `Linear: ${msg}` };
  }
  return json.data;
}

async function createIssue(input) {
  const title = String(input?.title || "").trim();
  if (!title) throw { code: "tool_error", message: "title is required" };
  if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw { code: "tool_error", message: "dueDate must be YYYY-MM-DD" };
  const teamId = crmToken("linear-team", process.env.LINEAR_TEAM_ID);
  if (!teamId) throw { code: "tool_error", message: "Linear: no team set for issues" };
  const issue = { teamId, title };
  if (input.description) issue.description = String(input.description);
  if (input.dueDate) issue.dueDate = input.dueDate;
  if (input.assigneeEmail) {
    const d = await gql(`query($email: String!) { users(filter: { email: { eq: $email } }) { nodes { id } } }`, { email: input.assigneeEmail });
    const id = d.users?.nodes?.[0]?.id;
    if (!id) throw { code: "tool_error", message: `Linear: no user with email ${input.assigneeEmail}` };
    issue.assigneeId = id;
  }
  const d = await gql(
    `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }`,
    { input: issue },
  );
  if (!d.issueCreate?.success) throw { code: "tool_error", message: "Linear: issue was not created" };
  return d.issueCreate.issue;
}

export default function linear({ force = false } = {}) {
  if (!force && (!process.env.LINEAR_API_KEY || !process.env.LINEAR_TEAM_ID)) return null;
  return {
    server: "Linear",
    tools: [{
      name: "create_issue",
      description: "Create a Linear issue in the team's backlog, optionally with a due date and assignee.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          dueDate: { type: "string", description: "YYYY-MM-DD" },
          assigneeEmail: { type: "string" },
        },
        required: ["title"],
      },
      run: createIssue,
    }],
  };
}
