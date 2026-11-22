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

Needs Node 20 or newer.

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
| `ENCORE_MCP_TOKEN` | unset | Shared bearer token for `/mcp` (audit log says "Claude (shared MCP token)") |
| `ENCORE_MCP_TOKENS` | unset | Per-person MCP tokens: `Name\|email\|token`, comma separated (tokens of 16+ characters) |
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

With `APP_PASSWORD` set, visitors see a password form and get a 30-day cookie. RSVP and survey links (`/#rsvp-…`, `/#survey-…`) keep working without a login: the login page forwards them to `/g`, which serves the page, and the shim marks their requests as guest requests. Guests can only read single event documents (an allowlisted view), the public part of the brand profile (name, logo, colors, fonts, voice, tagline), and the guest wall for one event (people going who opted in); and write to `rsvps`, `feedback`, `interest` and `wall`. Guest RSVPs are stamped `source: "guest"` (plus `utm` when sent) and can only be going, maybe, declined (`no`) or requested. Nominations need a signed-in team member.

### The daily project-manager job

`server/pm.js` runs on `PM_CRON` (weekdays at 8am Chicago time by default), or on demand with `POST /api/pm/run`. For every event that has a production plan (`produce.tasks`), a date and a status other than `done`, it works out each task's status the same way the page does (done, blocked, overdue, due within 3 days, or later; due = event date + the task's `days`). If anything is overdue, blocked or due soon, it asks Claude for short, friendly nudges per owner, the main risks with fixes, and anything the event lead must decide. Then it:

- posts each nudge to Slack, prefixed with the owner's name (if Slack is configured),
- saves the result to the event as `pmReport` (with a `posted` flag per nudge) and `pmRanAt`,
- adds a `notifications` document when the event lead needs to decide something,
- logs a one-line summary.

### Deploying

Any host that runs a Node 20 container and gives you a persistent disk works. Mount the disk at the data directory, since the database and uploads live there. Run a single instance: SQLite and the live-update stream are in-process.

- **Docker:** `docker build -t encore . && docker run -p 3000:3000 -v encore-data:/app/data --env-file .env encore`
- **Render:** new Web Service from the repo (Docker), add a Disk mounted at `/app/data`, set the env vars.
- **Fly.io:** `fly launch` (uses the Dockerfile), `fly volumes create encore_data`, mount it at `/app/data` in `fly.toml`, `fly secrets set ANTHROPIC_API_KEY=... APP_PASSWORD=...`.
- **Railway:** deploy from the repo (Dockerfile), attach a Volume at `/app/data`, set the variables.

Put the app behind HTTPS (all three do this for you) and set `APP_PASSWORD` before sharing the URL. The scheduled job runs inside the web process, so keep at least one instance always on.

## Named team members and the audit log

Set `ENCORE_USERS` so approvals and the decision log record a real person:

```
ENCORE_USERS="Maya Chen|maya@acme.com|Event lead+Account execs;Sam Lee|sam@acme.com|Exec sponsor"
```

Each person signs in with their work email plus their personal password (or the team password, `APP_PASSWORD`, if they have none). Plan approvals are limited to the roles listed for each person and to `ENCORE_APPROVER_ROLES` (default: every role on the team list). Approving needs a personal password, and the server refuses to start if anyone holding an approver role has none. `GET /api/approvals?eventId=…` returns the `required` roles and whether the plan is `fullyApproved`. Approvals reset when the plan's cost or committed spend moves more than 5%. Every approval, spend change and report correction is also written to an append-only audit log (`GET /api/audit?eventId=…`); the server stamps who and when, and the log can't be edited through the data API.

## CRM write-back

With HubSpot or Salesforce connected, "Log approved next steps" in Measure creates a task on each attendee's contact (HubSpot task, Salesforce Task) for their AE-approved next step, and records any gift and its cost.

## Use Encore from Claude

Encore runs as an MCP server, so a field marketer can plan, chase and report from a Claude chat.

1. On the server, give each person a token with `ENCORE_MCP_TOKENS="Maya Chen|maya@acme.com|<long random>,…"`, or set one shared `ENCORE_MCP_TOKEN`.
2. In Claude, add a custom connector: URL `https://<your-encore-host>/mcp`, header `Authorization: Bearer <token>`.
3. Add the skill in `claude/skills/encore-events/` so Claude knows which tool to use for which request.

Tools: `list_events`, `get_event`, `create_event`, `update_event`, `add_guests`, `guest_list`, `followups_due`, `pipeline_report`, `launch_kit`, `program_summary`. Anyone with a token can read and change events; treat it like a password. Every `create_event`, `update_event` and `add_guests` call is written to the audit log with the token's owner. Tools refuse bad input (dates must be real `YYYY-MM-DD`, currencies one of USD EUR GBP CAD AUD SGD JPY INR CHF SEK, amounts 0 or more). Setting `budget` on an event whose plan has budget lines scales the lines to the new total. Batched JSON-RPC requests are accepted.

## Sign-in and security

- `APP_PASSWORD` is required unless the server listens on localhost (or `ENCORE_ALLOW_OPEN=1` is set on purpose).
- With `ENCORE_USERS`, `SESSION_SECRET` is required. Give each person their own password by adding a 4th field: `Name|email|roles|scrypt$...` (generate it with `node server/hash-password.js 'their password'`). People without one sign in with the team password, and can't approve plans.
- Sign-in allows 10 failed tries per IP and email in 15 minutes, then answers 429. Signing out revokes that session on the server.
- Uploads must be images, video, PDF, CSV, text, Markdown or JSON. Files are served with `nosniff` and a sandboxing CSP; anything but images (not SVG), video and PDF is served as a download.
- Guest links (RSVP, guest wall, nomination, survey) only see an allowlisted view of an event: no emails, notes, money or deals. Plan links are signed per event; a plan view without a valid signature gets 403. Personal invites can be signed too: `POST /api/invitetoken` (team only) returns a token per guest, and a guest request for the event with `x-encore-invite: <encodeURIComponent(guestKey)>~<token>` also gets `me` (that guest's name, title, company, email and owner's first name) and `hosts`.
- Guests can only change responses they created (a per-browser key), and AE follow-up links are signed per AE.
- Saves carry the version they started from (`_base`); a stale save, or an event save without `_base` over an existing versioned event, is refused (409) instead of overwriting someone else's change.

## More integrations

- Webinars: Sequel (launch kit and, when connected, registrants and attendance).
- Call intelligence: Gong, Granola and Fathom, plus Slack search, feed account intel, the guest scout and sales briefs.
