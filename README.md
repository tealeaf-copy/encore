# Encore

A prototype event studio for B2B field marketers. A crew of AI agents takes an event from idea to launch: brand onboarding, buyer personas, idea deck, validation, venues, copy, promotion, production, guests, and impact.

## What's here

- `index.html`: the whole app, a single page published as a Claude artifact.
- `venues/venues.json`: research notes on the three Chicago venues used in the example event, with sources.

Venue photos are not stored in this repo. They're hosted with the published artifact and belong to the venues.

## How it runs

The page runs inside claude.ai as an artifact. It uses the viewer's Claude account for the AI agents, a shared database for events and feedback, and the viewer's own connectors (Gmail, Google Drive, Notion, and optionally Gong, HubSpot, Salesforce, web search) for research. Opened as a plain file in a browser, it shows example data and the AI features stay off.

## Running it as a web app (Node server)

The page can also run outside claude.ai, on a small Node.js server in this repo. The server serves `index.html` unchanged and a browser shim (`public/shim.js`) provides the platform features the page asks for with `window.claude.use(name)`: AI, a shared database, connectors, file uploads, downloads and the viewer's id.

### Setup

Needs Node 22 or newer.

```bash
npm install
cp .env.example .env      # then add ANTHROPIC_API_KEY, and Slack/Linear if you use them
npm start                 # http://localhost:3000
```

No key yet? `ENCORE_FAKE_AI=1 npm start` runs an offline demo: AI calls return canned text (`{"ok":true}` for JSON prompts) and web search returns placeholder results.

Run the tests with `npm test` (they use fake AI and a temporary database).

### Environment variables

| Variable | Default | What it does |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Where the server listens |
| `DATA_DIR` | `data` | SQLite database (`encore.db`) and uploaded files (`assets/`) |
| `DB_FILE` | `$DATA_DIR/encore.db` | Override the database file |
| `ASSET_MAX_MB` | `15` | Upload size limit |
| `APP_PASSWORD` | unset | Turns on a shared-password login |
| `SESSION_SECRET` | `APP_PASSWORD` | Signs the login cookie |
| `ENCORE_USERS` | unset | Named team members: `Name\|email\|role+role\|scrypt$…`, separated by `;` |
| `ENCORE_APPROVER_ROLES` | every team role | Comma list of the roles whose approval a plan needs |
| `ENCORE_ONE_APPROVAL_PER_PERSON` | `0` | `1` = one person can fill only one approver role per event (409 otherwise) |
| `ENCORE_TRUST_PROXY` | off | Trust `X-Forwarded-For` for client IPs: `1` (one proxy hop), a hop count, or an Express trust value like `loopback`. Set it behind Render/Fly/Railway or a load balancer |
| `ENCORE_MCP_TOKEN` | unset | Shared bearer token for `/mcp`, 32+ characters (audit log says "Claude (shared MCP token)") |
| `ENCORE_MCP_TOKENS` | unset | Per-person MCP tokens: `Name\|email\|token`, comma separated, 32+ characters each |
| `ENCORE_MCP_RATE_PER_MIN` | `120` | MCP messages per minute per token (each message in a batch counts) |
| `ENCORE_SIGNUP` | `0` | `1` = self-serve sign-up with workspaces and 14-day trials (needs `SESSION_SECRET`) |
| `ENCORE_SIGNUP_PER_HOUR` | `5` | Sign-ups and invite joins allowed per IP per hour |
| `ANTHROPIC_API_KEY` | unset | Claude key. Stays on the server |
| `ENCORE_FAKE_AI` | `0` | `1` = offline demo mode, no network calls |
| `SLACK_BOT_TOKEN` | unset | Slack Web API (send messages, DMs by email, find users) |
| `SLACK_DEFAULT_CHANNEL` | unset | Channel for messages with no channel given (PM nudges) |
| `SLACK_WEBHOOK_URL` | unset | Without a bot token: send-only Slack via an incoming webhook |
| `LINEAR_API_KEY` / `LINEAR_TEAM_ID` | unset | Linear issue creation |
| `HUBSPOT_TOKEN` | unset | HubSpot private app token (CRM search, attendee sync, pipeline) |
| `HUBSPOT_EVENT_ORGANIZER` | `Encore` | Organizer shown on HubSpot marketing events Encore creates |
| `SF_INSTANCE_URL` | unset | Salesforce My Domain URL. Needs `SF_ACCESS_TOKEN`, or `SF_CLIENT_ID` + `SF_CLIENT_SECRET` |
| `SF_ACCESS_TOKEN` | unset | Ready Salesforce access token |
| `SF_CLIENT_ID` / `SF_CLIENT_SECRET` | unset | Connected app for the OAuth 2.0 client-credentials flow (token cached and refreshed) |
| `SF_API_VERSION` | `v61.0` | Salesforce REST API version |
| `PM_CRON` | `0 8 * * 1-5` | When the daily project-manager job runs (`off` disables it) |
| `PM_TZ` | `America/Chicago` | Time zone for `PM_CRON` |
| `ENCORE_EMAIL_SERVICE` | `resend` | Default workspace only: `resend`, `postmark` or `sendgrid`. Other workspaces connect their own key in Setup |
| `ENCORE_EMAIL_KEY` | unset | Default workspace only: the sending service's API key |
| `ENCORE_EMAIL_FROM` | unset | Default workspace only: the From address, on a domain verified with the service |
| `ENCORE_EMAIL_PER_HOUR` | `300` | Most emails one workspace can send per hour |
| `ENCORE_FAKE_EMAIL` | `0` | `1` = record emails in the outbox without sending (demos and tests) |
| `ENCORE_PUBLIC_URL` | request host | Base URL used in links inside emails |

**Email, reminders and CRM writes.** With a sending service connected (Setup → Email from Encore), sign-off requests, guest invites and deadline reminders go from Encore, with replies to the sender; every message is logged in the outbox and the audit log. Deadline reminders run with `PM_CRON` (weekdays at 8am by default): each task owner gets one email listing what's late or due in two days, matched to teammates by name or role, at most once a day. Reading the CRM is open to the team; writing to it (attendee sync, follow-up tasks, account spend) is limited to people with the RevOps role, and anyone else's write waits in Setup → CRM writes until RevOps approves it.

`.env` is loaded at start-up; variables already set in the environment win.

### How the page's capabilities map to the server

| `window.claude.use(...)` | Server side |
|---|---|
| `sample` | `POST /api/ai` streams Server-Sent Events. The server runs Claude (`claude-opus-5-5`, effort from `modelTier`: quick=low, default=medium, complex=high) and the tool loop. When Claude calls one of the page's tools, the server sends a `tool_call` event, the shim runs the tool in the browser and posts the result to `/api/ai/:runId/tool-result`. Refusal fallbacks are on. `sample.json` parses the reply tolerantly |
| `db` | Firestore-style documents in SQLite. REST at `/api/db/doc` and `/api/db/collection`; live updates via one SSE stream at `/api/db/events` that tells the shim which paths changed |
| `mcp` | Server-side integrations in `server/integrations/`. Only configured ones are listed: **Parallel Search** (`web_search`, `web_fetch`, via Claude's web tools; on whenever AI is), **Slack** (`slack_send_message`, `slack_search_users`), **Linear** (`create_issue`), **HubSpot** (`search_crm_objects`, `upsert_event_attendees`, `event_pipeline`), **Salesforce - Beta** (`dispatch_readonly`, `upsert_event_attendees`, `event_pipeline`). Others the page knows (Gmail, Asana, ...) show as not connected |
| `assets` | `POST /api/assets` stores the file under `data/assets/`, served at `/_blob/:id` |
| `user` | A stable per-browser id in localStorage; everyone is an owner/editor |
| `downloads` | A normal browser download |
| anything else | `null` (the page hides those features) |

`GET /api/health` reports the AI mode (`live`, `fake` or `missing_key`) and the configured integrations.

### CRM sync (HubSpot and Salesforce)

With `HUBSPOT_TOKEN` or the `SF_*` variables set, the Measure step shows two more buttons next to the CSV export and import (HubSpot wins if both are set):

- **Sync attendees to HubSpot/Salesforce** sends every invited guest with an email, with the same status mapping as the CSV export (Invited, Registered, Attended, Declined).
  - HubSpot: upserts contacts by email, creates or updates a marketing event (external id = slug of name + date, external account `encore`) and records register/attend/cancel states by email. Invited guests are upserted as contacts only.
  - Salesforce: finds or creates the Campaign "Event: {name}" (type Event), adds any missing member statuses, matches each email to a Contact or an open Lead (creating a Lead with LeadSource "Event" if neither exists) and upserts the CampaignMember.
- **Pull pipeline** asks for deals/opportunities linked to the attended guests (HubSpot: deals associated with the contacts; Salesforce: opportunities on their accounts or with them as contact roles) created or moved stage in the 90 days after the event, and runs them through the same sourced/influenced rule as the CSV import.

The `dispatch_readonly` tool only accepts a single SOQL `SELECT`. CRM errors come back to the page as `tool_error`. Without a CRM configured the CSV export and import work as before.

### Login and guest links

With `APP_PASSWORD` set, visitors see a password form and get a 30-day cookie. RSVP and survey links (`/#rsvp-…`, `/#survey-…`) keep working without a login: the login page forwards them to `/g`, which serves the page, and the shim marks their requests as guest requests. Guests can only read single event documents (an allowlisted view; never nomination targets or owners), the public roadmap items of the canvas (no budgets, territories or items marked not public / employees / private), the public part of the brand profile (name, logo, colors, fonts, voice, tagline), and the guest wall for one event (people going who opted in); and write to `rsvps`, `feedback`, `interest` and `wall`. Guest RSVPs are stamped `source: "guest"` (plus `utm` when sent) and can only be going, maybe, declined (`no`) or requested. Nominations need a signed-in team member.

### The daily project-manager job

`server/pm.js` runs on `PM_CRON` (weekdays at 8am Chicago time by default), or on demand with `POST /api/pm/run`. For every event that has a production plan (`produce.tasks`), a date and a status other than `done`, it works out each task's status the same way the page does (done, blocked, overdue, due within 3 days, or later; due = event date + the task's `days`). If anything is overdue, blocked or due soon, it asks Claude for short, friendly nudges per owner, the main risks with fixes, and anything the event lead must decide. Then it:

- posts each nudge to Slack, prefixed with the owner's name (if Slack is configured),
- saves the result to the event as `pmReport` (with a `posted` flag per nudge) and `pmRanAt`,
- adds a `notifications` document when the event lead needs to decide something,
- logs a one-line summary.

### Deploying

Any host that runs a Node 22 container and gives you a persistent disk works. Mount the disk at the data directory, since the database and uploads live there. Run a single instance: SQLite and the live-update stream are in-process.

- **Docker:** `docker build -t encore . && docker run -p 3000:3000 -v encore-data:/app/data --env-file .env encore`
- **Render (easiest):** New > Blueprint, pick this repo. `render.yaml` sets up the Docker service, a disk at `/app/data`, a generated `SESSION_SECRET` and sign-up; Render asks you for `ANTHROPIC_API_KEY`, `ENCORE_PUBLIC_URL` and the email settings.
- **Fly.io:** `fly launch` (uses the Dockerfile), `fly volumes create encore_data`, mount it at `/app/data` in `fly.toml`, `fly secrets set ANTHROPIC_API_KEY=... APP_PASSWORD=...`.
- **Railway:** deploy from the repo (Dockerfile), attach a Volume at `/app/data`, set the variables.

- **Vercel in front of Render:** Vercel can't hold Encore's database, uploads or scheduled reminders (no lasting disk, no always-on process), so the server runs on Render and Vercel forwards every request to it. Deploy on Render first (above). Then put your Render address in `vercel.json` in place of `REPLACE-WITH-YOUR-RENDER-APP.onrender.com`, push, and import the repo in Vercel (Add New > Project, no settings to change). On Render, set `ENCORE_PUBLIC_URL` to the Vercel address so links in emails use it, and set `ENCORE_TRUST_PROXY=2` (Vercel, then Render's proxy). Sign-in cookies belong to the Vercel domain, so use that address, not the Render one.

Put the app behind HTTPS (all three do this for you) and set `APP_PASSWORD` before sharing the URL. The scheduled job runs inside the web process, so keep at least one instance always on.

## Named team members and the audit log

Set `ENCORE_USERS` so approvals and the decision log record a real person:

```
ENCORE_USERS="Maya Chen|maya@acme.com|Event lead+Account execs;Sam Lee|sam@acme.com|Exec sponsor"
```

Each person signs in with their work email plus their personal password (or the team password, `APP_PASSWORD`, if they have none). Plan approvals are limited to the roles listed for each person and to `ENCORE_APPROVER_ROLES` (default: every role on the team list). Approving needs a personal password, and the server refuses to start if anyone holding an approver role has none. `GET /api/approvals?eventId=…` returns the `required` roles and whether the plan is `fullyApproved`. Approvals reset when the plan's cost or committed spend moves more than 5%. Every approval, spend change and report correction is also written to an append-only audit log (`GET /api/audit?eventId=…`); the server stamps who and when, and the log can't be edited through the data API.

## Self-serve trials (workspaces)

With `ENCORE_SIGNUP=1`, signed-out visitors get `public/landing.html` at `/`, and anyone can start a 14-day trial at `/signup`. `/login` still works, and `/demo` runs the page on its built-in sample data with no login and nothing saved.

- **Workspaces.** Each sign-up creates a workspace and its owner account. Its data lives under `ws/<id>/…` in the same SQLite file. The page keeps using the same paths, and the server adds the prefix. The team from `ENCORE_USERS` / `APP_PASSWORD` is the `default` workspace, with the plain paths as before. Accounts, invites, MCP tokens and the event-to-workspace index are kept in `system/`, which the data API never serves. Event ids are unique across workspaces, so guest links (`#rsvp-<eventId>`, plan, AE and invite links) find the right workspace from the event. A guest page reads that workspace's brand and roadmap by sending `x-encore-workspace: <id>`: guest event reads return `workspace`. Signed links are signed per workspace.
- **API.**
  - `POST /api/signup {name, email, company, password, template?, plan?}` returns `{workspace, redirect}` and signs you in. The password must be 10+ characters.
  - `GET /api/workspace` returns `{id, company, plan, trialEndsAt, daysLeft, trial, trialEnded, writable, members, limits}`.
  - Owner only:
    - `POST /api/invite {email, role}` returns `{link:"/join#<token>", expiresAt}`, a one-time link valid for 7 days. The person opens it and `POST /api/join {token, name, password}` creates their account.
    - `POST /api/mcptoken {name?}` returns a 40-character token, shown once and stored hashed.
    - `POST /api/upgrade {plan:"team"|"program"}`.
- **Approvers in sign-up workspaces.** The roles whose approval a plan needs are the workspace's `approverRoles`, else `ENCORE_APPROVER_ROLES`, else members' roles that read like approvers (lead, sponsor, exec, VP, head, director, owner, approver, chief, CMO/CFO/CEO/COO, finance, budget, manager). An invite with no role shows as "Team member" and never counts. If no member role qualifies, the plan's own team leads are required.
- **AE nomination links.** These need no login: `#nominate-<eventId>-<aeSlug>~<token>`, where the token is the one `/api/aelink` issues. With that token in `x-encore-token`, a guest may PUT/PATCH `nominations/<eventId>--<aeSlug>`. A guest read of the event with `x-encore-view: nominate` also gets `nomFor` (the AE slug) and `nomSuggest`: up to 12 of that AE's own guests and scout contacts, with name, title and company only.
- **CRM connections.** These are per workspace and need no OAuth app.
  - `POST /api/connections {provider:"hubspot"|"attio", token}` (owner only) checks the token with one cheap read (HubSpot: list 1 company; Attio: `/v2/self`). It then stores the token encrypted (AES-256-GCM, key derived from `SESSION_SECRET`) in `system/`.
  - `GET /api/connections` returns `{connections:[{provider, connected, connectedAt, by}]}`. `DELETE /api/connections/:provider` removes one.
  - A workspace with a HubSpot token gets the HubSpot tools, run on its own token. This server's `HUBSPOT_TOKEN` is only used by the default workspace.
  - Attio tokens are checked and stored, but there are no Attio tools yet.
  - Salesforce uses the OAuth 2.0 client-credentials flow: `POST /api/connections {provider:"salesforce", instanceUrl, clientId, clientSecret}`.
    - `instanceUrl` must be `https://…salesforce.com` or `https://…force.com`, so the server can't be pointed anywhere else.
    - The server gets a token from `<instanceUrl>/services/oauth2/token` and checks it with `GET /services/data/v60.0/limits`. It stores only the encrypted client credentials and fetches new access tokens when needed.
    - The Salesforce tools then run against that workspace's org. The `SF_*` env settings are only used by the default workspace.
  - Slack: `{provider:"slack", token:"xoxb-…", channel?}`, checked with `auth.test`. The Slack tools and the daily project-manager nudges use the workspace's bot, posting to `channel` by default. This server's `SLACK_*` settings are only used by the default workspace.
  - Linear: `{provider:"linear", token, teamId?}`, checked with `{ viewer { id } }`. Issues go to `teamId`, or to the first team if none is given.
  - Gong: `{provider:"gong", accessKey, accessKeySecret, baseUrl?}`. `baseUrl` must be `https://….gong.io` and defaults to `https://api.gong.io`. The keys are checked with `GET /v2/users?limit=1` (Basic auth). The workspace gets a read-only `gong_search_calls` tool: `{fromDate, toDate, domains?, limit?}` returns calls with title, date, the companies on the call and Gong's brief, never transcripts.
  - If `SESSION_SECRET` changes, stored tokens can't be decrypted and must be connected again.
- **Approver roles.** Owner only: `POST /api/workspace/approvers {roles:[…]}` sets the roles whose approval a plan needs (an empty list goes back to the automatic rule), and `PATCH /api/members/:email {roles:[…]}` changes a member's roles. `GET /api/workspace` returns `approverRoles` (the roles in effect) and `approverRolesSet` (the list set explicitly). Approver-like names include CFO, CRO, VP/SVP Sales, Finance, Manager, Exec sponsor, RevOps, Head of …, Director, Founder.
- **Conference nominations by link.** Sales and execs can nominate without a login.
  - `GET /api/confnomlink` (signed in) returns `{token, ws, link:"/g#confnom~ws-<ws>~<token>"}`.
  - A guest request with `x-encore-workspace: <ws>` and `x-encore-token: <token>` may POST one conference at a time to `/api/db/collection?path=conferences`, up to 20 per IP per hour. Only `name, url, date, city, why, accounts[], nominatedBy[]` are kept; `stage` is set to `nominated`, `votes` to `{}` and `source` to `link`.
  - With the same headers, a GET of that collection returns only each conference's `name, date, city, stage`.
- **MCP tokens.** `GET /api/mcptoken` returns `{tokens:[{id, name, email, createdAt, lastUsedAt}]}`, never the token. `DELETE /api/mcptoken/:id` revokes one.
- **Contact inbox.** `POST /api/contact {kind:"talk"|"security"|"billing", name, email, company, message}` is open to signed-out visitors: 5 per IP per hour (`ENCORE_CONTACT_PER_HOUR`), name and company capped at 120 characters, message at 5000. Messages are logged as `[contact] …` and stored in `system/`. Signed-in senders' messages carry their workspace. `GET /api/contact` is for the default workspace's own team.
- **Single sign-on (OpenID Connect).** Works with Okta, Google Workspace, Microsoft Entra, OneLogin and other OIDC providers.
  - **Setup (owner only).** `POST /api/sso {issuer, clientId, clientSecret, domain, enforce?}`.
    - The server fetches `<issuer>/.well-known/openid-configuration`. It must be https on a public address, with no private or metadata IPs and no redirects. It must list `authorization_endpoint`, `token_endpoint` and `jwks_uri`, and its `issuer` must match.
    - `domain` must be the owner's own email domain and can't be a public mail domain. One workspace per domain.
    - The client secret is stored encrypted.
    - `GET /api/sso` returns `{configured, issuer, domain, enforce, configuredBy, redirectUri}`. `DELETE /api/sso` turns it off.
    - Register `redirectUri` (`<ENCORE_PUBLIC_URL or this host>/sso/callback`) with the provider. Set `ENCORE_PUBLIC_URL` behind a proxy.
  - **Sign-in.** `/sso/start?email=…` (linked from the login page) sends the person to their provider using PKCE (S256), `state` and `nonce`, kept in a 10-minute encrypted cookie. `/sso/callback` exchanges the code and checks the ID token:
    - The signature is RS256 or ES256, checked against the provider's JWKS.
    - `iss`, `aud`/`azp`, `exp` and `nonce` must match.
    - `email_verified` can't be false, and the email (or Entra's `preferred_username`) must be on the configured domain.
    - On first sign-in the person joins the workspace as "Team member", which never counts as an approver role.
  - **Enforce.** With `enforce:true`, password sign-in for the domain answers `401 {code:"sso_required", sso:"/sso/start?email=…"}` (the login form shows a message). The one exception is the owner who set SSO up: they keep their password as a break-glass in case the provider breaks, and should keep it strong.
  - `ENCORE_SSO_ALLOW_LOCAL=1` allows http and local providers. It's for tests only.
- **Trials.** Every feature works during the trial. After `trialEndsAt`, changes get `402 {code:"trial_ended"}` (MCP writes too), and reading still works. Guest RSVPs keep working.
- **Billing isn't wired.** `/api/upgrade` only records the request and sets `plan` to `pending_<plan>`, and that doesn't unlock writes. Once a customer has paid, an operator sets the workspace's `plan` to `team` or `program` in its `system/ws-<id>` document.
- Sign-up workspaces don't get this server's own Slack, Linear or CRM keys. Only web search is shared. AI calls do use the server's Anthropic key.

## CRM write-back

With HubSpot or Salesforce connected, "Log approved next steps" in Measure creates a task on each attendee's contact (HubSpot task, Salesforce Task) for their AE-approved next step, and records any gift and its cost.

## Use Encore from Claude

Encore runs as an MCP server, so a field marketer can plan, chase and report from a Claude chat.

1. On the server, give each person a token with `ENCORE_MCP_TOKENS="Maya Chen|maya@acme.com|<long random>,…"`, or set one shared `ENCORE_MCP_TOKEN`.
2. In Claude, add a custom connector: URL `https://<your-encore-host>/mcp`, header `Authorization: Bearer <token>`.
3. Add the skill in `claude/skills/encore-events/` so Claude knows which tool to use for which request.

Tools: `list_events`, `get_event`, `create_event`, `update_event`, `add_guests`, `guest_list`, `followups_due`, `pipeline_report`, `launch_kit`, `program_summary`. Anyone with a token can read and change events; treat it like a password. Every `create_event`, `update_event` and `add_guests` call is written to the audit log with the token's owner; reads are logged too as `kind: "read"` (left out of `GET /api/audit` unless `&reads=1`). Tokens shorter than 32 characters stop the server from starting. Pipeline totals count only confirmed deals (matched to an attendee contact, or confirmed by a person) and convert each deal's `currency` to USD; `registered` counts Going/Attended guests plus RSVPs saying going; a series master with cities isn't added to planned totals. Tools refuse bad input (dates must be real `YYYY-MM-DD`, currencies one of USD EUR GBP CAD AUD SGD JPY INR CHF SEK, amounts 0 or more). Setting `budget` on an event whose plan has budget lines scales the lines to the new total. Batched JSON-RPC requests are accepted.

## Sign-in and security

- `APP_PASSWORD` is required unless the server listens on localhost (or `ENCORE_ALLOW_OPEN=1` is set on purpose).
- With `ENCORE_USERS`, `SESSION_SECRET` is required. Give each person their own password by adding a 4th field: `Name|email|roles|scrypt$...` (generate it with `node server/hash-password.js 'their password'`). People without one sign in with the team password, and can't approve plans.
- Sign-in allows 10 failed tries per IP and email in 15 minutes, and 20 per email per hour from any IP, then answers 429. Client IPs come from `X-Forwarded-For` only with `ENCORE_TRUST_PROXY`. Signing out revokes that session on the server.
- Uploads must be images, video, PDF, CSV, text, Markdown or JSON. Files are served with `nosniff` and a sandboxing CSP; anything but images (not SVG), video and PDF is served as a download.
- Guest links (RSVP, guest wall, nomination, survey) only see an allowlisted view of an event: no emails, notes, money or deals. Plan links are signed per event; a plan view without a valid signature gets 403. Personal invites can be signed too: `POST /api/invitetoken` (team only) returns a token per guest, and a guest request for the event with `x-encore-invite: <encodeURIComponent(guestKey)>~<token>` also gets `me` (that guest's name, title, company, email and owner's first name) and `hosts`.
- Guests can only change responses they created (a per-browser key), and AE follow-up links are signed per AE.
- Saves carry the version they started from (`_base`); a stale save, or an event save without `_base` over an existing versioned event, is refused (409) instead of overwriting someone else's change.

## More integrations

- Webinars: Sequel (launch kit and, when connected, registrants and attendance).
- Call intelligence: Gong, Granola and Fathom, plus Slack search, feed account intel, the guest scout and sales briefs.

## Invite-only and host pages

- `ENCORE_INVITE_ONLY=1` (set in `render.yaml`): the first person to sign up gets in; after that, sign-up needs an invite code. Every member gets five codes (Host kit → Pip can help → Your regulars, or `GET /api/codes`). A shared link looks like `/join?code=ABCD-EFGH`. People without a code can join the waitlist, and members can send them a code. The inviter and the new member follow each other.
- `ENCORE_FOUNDER_CODES`: optional comma-separated codes that always work (for seeding a city or a launch list).
- Host pages live at `/h/<handle>`. Anyone can follow with just an email. `/discover` lists hosts and the get-togethers they chose to show there.
