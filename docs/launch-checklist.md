# Launch checklist: the first cohort

The goal: 10 field marketers, 100 event registrants and 10 hosts who host at least 10 events in the next month.

Do everything in **Before you invite anyone** first. Then open **/admin/launch** on the live site (signed in with an
email listed in `ENCORE_ADMIN_EMAILS`). It reads the running server's settings and shows each one as:

- **Ready** (green): set and looks right.
- **Check** (amber): optional, or set in a way that works but may not be what you want.
- **Fix** (red): the cohort will hit a problem. Fix every red line before you send a single invite.

It never shows a value, only whether a setting is there. The same page counts progress toward the goal and makes
invite codes.

All settings live in Render: your service, **Environment**. Saving there restarts the server (about a minute of
downtime), so set everything in one go and don't change settings while people are onboarding.

## Before you invite anyone

### 1. The server

| Setting | Required | What it does | How to check it works |
|---|---|---|---|
| `ENCORE_PUBLIC_URL` | Yes | The site's public address, like `https://potterylab.com`. Every link in an email or text uses it. | /admin/launch shows it green. Send yourself a sign-in link and tap it: it opens the live site, not `localhost` or the Render address. |
| `ENCORE_TRUST_PROXY` | Yes, set to `1` | Render sits in front of the app. With `1`, limits count each visitor; without it every visitor looks like one address, so one busy event locks everyone out. | Green on /admin/launch. |
| `SESSION_SECRET` | Yes | Signs sign-in cookies. 32 or more random characters. `render.yaml` generates one. Never change it after launch: everyone gets signed out. | Green on /admin/launch. Sign in, redeploy, and you're still signed in. |
| `ENCORE_SIGNUP` | Yes, set to `1` | Lets people make accounts. | /signup shows the form. |
| `ENCORE_CANONICAL_HOST` | If you use your own domain | Sends visits on other host names (the onrender.com one) to your domain. | Open the onrender.com address: you land on your domain. |
| No test switches | Yes | None of `ENCORE_FAKE_EMAIL`, `ENCORE_FAKE_SMS`, `ENCORE_FAKE_AI`, `ENCORE_FAKE_PUSH`, `ENCORE_FAKE_OAUTH`, `ENCORE_FAKE_GEO`, `ENCORE_FAKE_CRM`, `ENCORE_FAKE_WEBHOOK` may be set in production. With them on, nothing is really sent. | "No test switches on" is green on /admin/launch. |

### 2. The database: persistent disk and backups

The database (`encore.db`) and uploads (`assets/`) live on the Render disk from `render.yaml`: 10 GB, mounted at
`/app/data`. Without a disk, every deploy wipes every account and event.

- **Check the disk.** Render, your service, **Disks**: a disk is attached at `/app/data`. On /admin/launch,
  "Database on the persistent disk" is green.
- **`DATA_DIR`** (optional): where the data folder is. Leave it unset on Render (it defaults to `/app/data` in the
  image). **`DB_FILE`** (optional) moves just the database file. Don't set either unless you move the disk.
- **Make a backup before you invite anyone**, then once a night. In Render, your service, **Shell**:

  ```
  mkdir -p /app/data/backups && cd /app && node -e "require('better-sqlite3')('/app/data/encore.db').exec(\"VACUUM INTO '/app/data/backups/encore-\" + new Date().toISOString().slice(0, 10) + \".db'\")"
  ```

  It works while the server runs and writes one consistent file. "A recent backup" on /admin/launch turns green
  when a copy younger than two days is in `/app/data/backups`. Copy the file off Render too (S3, Backblaze or your
  laptop), with the `/app/data/assets` folder, and delete copies older than 30 days so the disk doesn't fill.
- **Render's own snapshots.** Render snapshots the disk once a day. They stay inside Render.
- **How to restore.**
  1. From a snapshot: Render, your service, **Disks**, pick a snapshot, **Restore**. It puts back the whole disk, so
     everything written since that snapshot is lost. Say so on the status line first (see below).
  2. From a copy: in **Shell**, stop writes by turning on the status line ("Back in 5 minutes"), then
     `cp /app/data/backups/encore-YYYY-MM-DD.db /app/data/encore.db` and restart the service from the Render dashboard.
  3. Check it: sign in, open /admin/launch, and the goal counts look right.
- **Check a copy once a month**: `node -e "console.log(require('better-sqlite3')('/app/data/backups/<file>.db').prepare('select count(*) n from docs').get())"`
  prints more than zero.

### 3. Who gets in

| Setting | Required | What it does | How to check it works |
|---|---|---|---|
| `ENCORE_INVITE_ONLY` | Yes, set to `1` for the cohort | New hosts and brands need an invite code. Guests never need one to reply. | /signup asks for a code. |
| `ENCORE_ADMIN_EMAILS` | Yes | Comma list of the people who run the cohort. They see /admin/launch, /support and the other admin pages, once they've confirmed their email. Everyone else gets a 404. | Open /admin/launch signed in as yourself: it loads. Open it signed out: "Page not found". |
| `ENCORE_FOUNDER_CODES` | No | A reusable code (comma list), limited per IP and per day by `ENCORE_FOUNDER_PER_IP` and `ENCORE_FOUNDER_PER_DAY`. For the cohort, use batches instead: each code works once and you can see who used it. | |

**Invite codes for the cohort (on /admin/launch, Invite codes):**

1. Pick **Hosts**, type 15 (a few spare), a label like "December hosts", tap **Make codes**.
2. Pick **Brands (field marketers)**, type 15, label "December brands", **Make codes**.
3. Only if registrants want their own account: **Guests who want an account**. Registrants who only reply to events
   need no code and no account. That's most of the 100.
4. Tap **Download CSV** on each batch. Each row has the code and a sign-up link with the code already in it: hosts and
   guests get `/signup?mode=friends&code=…`, brands get `/signup?mode=work&code=…` (the work form, for a team account).
   Send each person their own link. Each code works once.
5. The batch shows "Used 3 of 15" as people join, and the CSV says who used each code and when.

A batch code connects nobody: unlike a friend's host code, using it doesn't make anyone follow anyone.

### 4. Support

| Setting | Required | What it does | How to check it works |
|---|---|---|---|
| `ENCORE_SUPPORT_EMAIL` | Yes | Where new help tickets are emailed (comma list). Without it, tickets are still stored and listed on /support, and /support shows a red setup line. | Signed out, open any invite, tap **Help**, **Talk to a person**, send a test with your own email. It lands in this inbox and on /support. |
| `ENCORE_SUPPORT_SMS` | Strongly recommended | Phone numbers (comma list, `+15551234567`) that get a text the moment someone taps **My event is today**. Needs texting set up (`ENCORE_TWILIO_*` below). | Send a test with **My event is today**: your phone buzzes. /admin/launch is green only when texting is set up too. |
| `ENCORE_SUPPORT_REPLY_HOURS` | No (default 24) | The reply time people are promised: "We reply within 24 hours, usually sooner." Set what you can keep. | The help sheet shows your number under **Talk to a person**. |
| `ENCORE_SAFETY_EMAIL` | No | Where reports of people and posts go. Falls back to `ENCORE_SUPPORT_EMAIL`. | |
| `ENCORE_HELP_PER_HOUR`, `ENCORE_HELP_PER_HOUR_IP`, `ENCORE_HELP_TICKETS_PER_HOUR`, `ENCORE_HELP_TICKETS_PER_HOUR_IP` | No | Limits on questions to Potto (30 an hour signed in, 10 an hour per address signed out) and tickets (10 and 5). | |

How support works during the cohort:

- Everyone can reach help from every page: the **Help** link in the side menu and the phone's **Me** sheet, the
  footer of every page, every invite (`/e/…`, `/g`), the chat's details (**Get help**), /teams pages, sign-in and
  sign-up, the 404, error and offline pages, and every "Something went wrong" message (**Get help**, with a ref).
- Potto answers from `docs/help.md` first. **Talk to a person** is always at the bottom with the promised time.
  Signed-out people leave an email or a phone.
- **/support** (admins) lists tickets with urgent ones first, shows the page, role, event or booking, device, app
  version and recent error ids, and lets you reply (it goes by email, by text when they only left a phone, and into
  their help chat) and mark it solved.
- **The status line**: on /support or /admin/launch, type a short message ("Texts are slow right now. Email works.")
  and tap **Show it**. Everyone sees a quiet line at the top of every page and in the help sheet until you **Clear** it.
- **Errors you don't hear about**: script errors and server errors land in **Recent errors** on /admin/launch, with
  an id. A ticket shows the ids from that person's device, so you can match them.

### 5. Sending email and texts

| Setting | Required | What it does | How to check it works |
|---|---|---|---|
| `ENCORE_EMAIL_KEY` | Yes | The API key for your email provider. | /admin/launch: "Email" green. Sign in by email: the link arrives within a minute. |
| `ENCORE_EMAIL_FROM` | Yes | The from address, on a domain you verified with the provider (SPF and DKIM set). | The sign-in email isn't in spam. |
| `ENCORE_EMAIL_SERVICE` | No (default `resend`) | Which provider the key is for. | |
| `ENCORE_EMAIL_FROM_NAME` | No | The from name, like "Pottery Lab". | |
| `ENCORE_EMAIL_PER_HOUR` | No | A cap on emails per workspace per hour. | |
| `ENCORE_TWILIO_SID`, `ENCORE_TWILIO_TOKEN`, `ENCORE_TWILIO_FROM` | Recommended | Twilio for texts: reminders, reply by text, urgent support alerts and replies to people who left only a phone. `ENCORE_TWILIO_FROM` is your Twilio number, `+1…`. | /admin/launch: "Texts" green. Tap **My event is today** in a test: `ENCORE_SUPPORT_SMS` gets a text. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | No | The same Twilio account, read only by sign-in codes by text. Setting the `ENCORE_TWILIO_*` three covers sign-in too, so you don't need these. | |

### 6. Sign-in with Apple and Google (optional, but half-set is worse than none)

A provider with some keys and not others shows a button that fails. /admin/launch shows red for a half-set provider.
How to make the keys: `docs/sign-in-setup.md`.

| Setting | What it does |
|---|---|
| `ENCORE_APPLE_SERVICES_ID`, `ENCORE_APPLE_TEAM_ID`, `ENCORE_APPLE_KEY_ID`, `ENCORE_APPLE_PRIVATE_KEY` | Sign in with Apple (all four). |
| `ENCORE_GOOGLE_CLIENT_ID`, `ENCORE_GOOGLE_CLIENT_SECRET` (or `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) | Sign in with Google on the web. |
| `ENCORE_GOOGLE_IOS_CLIENT_ID`, `ENCORE_GOOGLE_ANDROID_CLIENT_ID` | Google sign-in inside the phone apps. |
| `ENCORE_PASSKEY_RP_ID`, `ENCORE_PASSKEY_ORIGINS` | Passkeys: your domain, and the origins allowed. Set them if you use your own domain. |

Check: tap each button on /login with a real account and land signed in.

### 7. Features the cohort will touch

| Setting | Required | What it does | How to check it works |
|---|---|---|---|
| `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) | Recommended | Potto's writing: turning one sentence into an event, help answers in plain words. Without it, Potto answers from the help guide only. | Make an event from one sentence: the fields fill in. |
| `ENCORE_AI_PER_HOUR`, `ENCORE_AI_READS_PER_HOUR`, `ENCORE_POTTO_PER_HOUR`, `ENCORE_POTTO_TOKENS_PER_DAY` | No | Limits on Potto per person, so one loop can't run up a bill. | |
| `STRIPE_SECRET_KEY` | For paid memberships and team booking deposits | Payments through Stripe. A `sk_test_…` key is test mode: no real money moves. | /admin/launch: "Payments" amber means test mode. Book a test experience with a Stripe test card. |
| `ENCORE_STRIPE_LIVE` | With a live key | Set to `1` together with a `sk_live_…` key to take real money. | "Payments" green. |
| `STRIPE_WEBHOOK_SECRET` | For paid memberships | The signing secret of the Stripe webhook at `/api/stripe/webhook` (events on connected accounts). Memberships stay off without it. See docs/memberships.md. | `/api/admin/memberships` shows the webhook as set. |
| `ENCORE_MEMBERSHIP_FEE_BPS` | No | The platform fee on memberships in basis points (0 at launch, capped at 3000). | |
| `ENCORE_MEMBERSHIPS` | No | `0` turns paid memberships off even with Stripe set. | |
| `STRIPE_CONNECT_CLIENT_ID` | No | Only for Standard Connect accounts; Express accounts (the default) don't need it. | |
| `ENCORE_TEAM_FEE_BPS`, `ENCORE_REPEAT_FEE_PCT` | No | Pottery Lab's fee on team bookings (basis points, default 0) and the repeat booking discount (percent, default 50). | |
| `ENCORE_POSTHOG_KEY`, `ENCORE_POSTHOG_HOST` | Recommended | Product analytics in PostHog: see where the cohort gets stuck. The host defaults to PostHog's US cloud. | /admin/launch green. Open a page, then see the visit in PostHog's live events. |
| `ENCORE_POSTHOG_REPLAY`, `ENCORE_ANALYTICS_SALT` | No | `1` turns on masked session replay; the salt hashes ids before they go to PostHog (defaults to `SESSION_SECRET`). | |
| `GIPHY_API_KEY` or `TENOR_API_KEY` | No | GIFs in chats. Without one the GIF button stays hidden. `ENCORE_GIFS_PER_IP_HOUR` limits searches. | A chat shows the GIF button and a search returns GIFs. |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | No | The official Instagram connection for **Start from your Instagram**, through a Meta app with the Instagram API with Instagram Login (professional accounts only). `INSTAGRAM_REDIRECT_URI` sets the callback if it isn't the default; `INSTAGRAM_GRAPH_VERSION` and `INSTAGRAM_PKCE` are advanced. Without them the photo way in still works and the connect button stays hidden. Meta's app review can take days: start early, or skip it for the cohort. | /admin/launch green. A test host connects Instagram and sees a draft. |
| `ENCORE_GEO_PROVIDER`, `ENCORE_GEO_KEY`, `ENCORE_GEO_URL` | No | Address lookup for maps. Without them the free public geocoder is used, with a small daily limit (`ENCORE_GEO_PER_DAY`, spaced by `ENCORE_GEO_GAP_MS`; `ENCORE_GEO_UA` adds your contact to its user agent). | Type an address on a new event: it finds it. |
| `ENCORE_PLACES_URL`, `ENCORE_MAP_TILES`, `ENCORE_MAP_HOSTS` | No | The place search service (`off` turns it off), the map tiles, and extra tile hosts allowed by the page's security rules. | The map on /discover draws. |
| `ENCORE_HIDE_DEMO`, `ENCORE_HIDE_PREVIEWS`, `ENCORE_FEED_PREVIEWS` | Recommended once real events are up | Hide the sample hosts and preview pages from Discover and the feed, or pick which previews show. | Discover shows only real hosts. |
| `ENCORE_COHORT_START` | Recommended | The cohort's first day (`2026-12-01`). /admin/launch then counts the goal from that day, not all time. | /admin/launch says "Counting from …". |

Paid insights (server/paidinsights.js): Market insights for brand teams (`/teams/market`, per seat), Host insights (`/host/insights`) and the opt-in "who comes" answers in Settings. With `STRIPE_SECRET_KEY` and a webhook secret set, teams and hosts subscribe through Stripe Checkout; add a webhook in Stripe at `<your address>/api/paid-insights/stripe/webhook` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` and `invoice.payment_failed`. Without Stripe they press Request access, and an admin grants it at /admin/paid-insights.

| Setting | Needed? | What it does | How to check |
|---|---|---|---|
| `STRIPE_INSIGHTS_WEBHOOK_SECRET` | With Stripe | The signing secret of the paid insights webhook above (`whsec_…`). If it's not set, `STRIPE_WEBHOOK_SECRET` is used. | /admin/paid-insights says "Payments are on". |
| `ENCORE_MARKET_INSIGHTS_SEAT_CENTS` | No | Price of one Market insights seat a month, in cents (default 4900, $49). | The price on /teams/market. |
| `ENCORE_HOST_INSIGHTS_CENTS` | No | Price of Host insights a month, in cents (default 1000, $10). Free for hosts with a membership turned on. | The price on /host/insights. |
| `ENCORE_INSIGHTS_K` | No | The fewest people a "who comes" part can show with (default 25, never under 5). | A thin city says "Not enough yet". |
| `ENCORE_DEMOGRAPHICS_MIN_OPTINS` | No | How many people must opt in before "who comes" shows to anyone (default 250). Until then it collects only. | /teams/market says "switches on once ...". |
| `ENCORE_DEMOGRAPHICS` | No | `0` turns "who comes" off everywhere, including the Settings section. | Settings has no "Help hosts and brands" section. |
| `ENCORE_INSIGHTS_DIGEST` | No | `0` stops the monthly Market insights email. | No digest emails go out. |

Brand proposals (`/proposals`, server/proposals.js) need no setting of their own. They use the team booking deposit path (`STRIPE_SECRET_KEY` above), the fee (`ENCORE_TEAM_FEE_BPS`, shown in dollars) and Potto (`ANTHROPIC_API_KEY`; without it, "make it shorter" and "make it warmer" use plain rules). With `ENCORE_HIDE_DEMO=1` the example proposals (`/proposals/example/<template>`) are hidden with the example hosts. To check: as a host with a team request, open Team requests, tap "Send a proposal", send it, then open the link signed in as the brand and accept; the booking shows "Accepted, deposit due".

### 8. The phone apps (only if you ship them to the cohort)

| Setting | What it does |
|---|---|
| `ENCORE_IOS_BUNDLE_ID`, `ENCORE_APPLE_TEAM_ID` | Universal links for the iPhone app. |
| `ENCORE_ANDROID_PACKAGE`, `ENCORE_ANDROID_SHA256` | App links for Android. |
| `ENCORE_APNS_KEY`, `ENCORE_APNS_KEY_ID`, `ENCORE_APNS_ENV` | Push to iPhones. |
| `ENCORE_FCM_PROJECT_ID`, `ENCORE_FCM_CLIENT_EMAIL`, `ENCORE_FCM_PRIVATE_KEY` | Push to Android. |
| `ENCORE_APP_SCHEME` | The app's link scheme (default `potterylab`). |

## The day before you invite anyone

1. /admin/launch: no red lines.
2. Make a backup (above) and check the file is there.
3. Make the code batches and download the CSVs.
4. Sign up with a host code in a private window, make an event from one sentence, share it, and reply to it from
   your phone signed out. Then open **Help** on the invite and send a test ticket with **My event is today**. Check
   the email, the text and /support. Reply from /support and see the reply in the help sheet on the phone.
5. Sign up with a brand code (the work link) and request a booking from your test host.
6. Clear the test tickets (mark them solved) and the status line.

## During the cohort

- Each morning: /admin/launch (the goal and **Recent errors**) and /support (urgent first).
- If something is broken for everyone, turn on the status line right away, then fix it.
- Don't deploy while people are onboarding: each deploy takes the site down for about a minute.

## Every setting the server reads

The tables above cover what the cohort needs. These are the rest, so nothing in the code is a surprise. A test
(`test/launch-support.test.js`) checks that every setting the server reads is named in this file.

| Setting | Required | What it does |
|---|---|---|
| `PORT`, `HOST` | No | Where the server listens (Render sets `PORT`). |
| `NODE_ENV` | No | `production` on Render; a few dev-only paths check it. |
| `APP_PASSWORD` | No | A single shared password for a private, single-team install. Not for the cohort. |
| `ENCORE_ALLOW_OPEN` | No | Allows running with no password and sign-up off on a public address. Never in production. |
| `ENCORE_USERS` | No | Named team members for a private install. Not for the cohort. |
| `ENCORE_VERIFY_EMAIL` | No | `0` turns off email confirmation. Leave it unset in production. |
| `ENCORE_SIGNUP_PER_HOUR` | No | Sign-ups per address per hour. |
| `ENCORE_RSVP_PER_HOUR`, `ENCORE_RSVP_IP_PER_HOUR` | No | Replies per event and per address per hour. Raise them for a very big event. |
| `ENCORE_CONTACT_PER_HOUR`, `ENCORE_CONTACT_MATCH_PER_HOUR`, `ENCORE_CONTACT_MATCH_PER_IP_HOUR` | No | The contact form, and finding friends from contacts. |
| `ENCORE_NOTE_PER_HOUR`, `ENCORE_NOTE_IP_PER_HOUR` | No | Notes to hosts. |
| `ENCORE_CONFNOM_PER_HOUR`, `ENCORE_CWM_PER_HOUR`, `ENCORE_INTEREST_PER_IP_HOUR` | No | Nominations, "Come with me?" asks, and interest sign-ups. |
| `ENCORE_FEED_PER_IP_HOUR`, `ENCORE_FEED_COMMENTS_PER_HOUR`, `ENCORE_FEED_COMMENTS_PER_IP_HOUR`, `ENCORE_FEED_KUDOS_PER_HOUR`, `ENCORE_FEED_KUDOS_PER_IP_HOUR`, `ENCORE_REACTS_PER_IP` | No | Limits on the feed: reads, comments, kudos and reactions. |
| `ENCORE_KUDOS_AT_WRONG`, `ENCORE_KUDOS_GROUP_PER_CONTACT`, `ENCORE_KUDOS_GROUP_PER_EVENT`, `ENCORE_KUDOS_GROUP_PER_IP` | No | Limits on kudos asks and wrong-code tries. |
| `ENCORE_GIFT_DRAFTS_PER_HOUR`, `ENCORE_DIRECTORY_PER_HOUR`, `ENCORE_ORDER_ITEMS_PER_IP_HOUR`, `ENCORE_MCP_RATE_PER_MIN` | No | Limits on gift drafts, the directory, shop orders and the MCP API. |
| `ENCORE_ORDER_HOLD_HOURS` | No | How long an unpaid order holds stock. |
| `ENCORE_DELETE_GRACE_DAYS` | No | Days before a deleted account is gone for good. |
| `ENCORE_REPLY_DIGEST_GAP_HOURS` | No | How often hosts get a digest of new replies. |
| `ENCORE_POTTO_TEXT` | No | `0` turns Potto by text off even with Twilio set (sign-in codes still go out). See docs/potto-text.md. |
| `ENCORE_WEATHER` | No | The weather line on the guests' morning-of card (server/delightafter.js). `open-meteo` reads Open-Meteo's free forecast for the area's centre (never the address) at the start time, no key needed; allow `api.open-meteo.com` if outbound traffic is limited. `fake` is for tests and demos. Unset: no weather line at all. |
| `ENCORE_INVITES_PER_MEMBER` | No | Friend invites each member can text (default 5). |
| `TWILIO_WHATSAPP_FROM` | No | The WhatsApp sender number through Twilio. Turns on Potto by WhatsApp. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_NUMBER` | No | Meta's WhatsApp Cloud API instead of Twilio. |
| `POTTO_WA_TEMPLATE_LANG` | No | Language code for WhatsApp templates on the Cloud API (default `en_US`). |
| `ENCORE_SUGGEST_PER_MIN`, `ENCORE_SUGGEST_PER_HOUR`, `ENCORE_SUGGEST_TIMEOUT_MS` | No | Potto autocomplete (server/suggest.js): requests per person a minute (30) and an hour (300), half for signed-out visitors, and how long to wait for Potto before showing only the instant suggestions. |
| `ENCORE_LISTS_NUDGE_MIN` | No | When the lists nudge first shows. |
| `ENCORE_TRENDS_MIN_HOSTS`, `ENCORE_TRENDS_MIN_GUESTS` | No | How much data Potto needs before it calls a format popular in a city (defaults 3 hosts and 15 guests, server/trends.js). Trend notes ("Trending on social") are edited at `/api/admin/trend-notes` by the people in `ENCORE_ADMIN_EMAILS`, and drop out by themselves after 120 days. |
| `ENCORE_INSPIRATION_TODAY` | No, leave it unset | QA only: pins the day the feed's inspiration cards (server/inspiration.js) think it is, as YYYY-MM-DD, to check a holiday's lead window. Unset, they use today. New places the team spots go in by hand at `/api/admin/spot-notes` (admins only, ENCORE_ADMIN_EMAILS): POST `{ name, hood, city, category (dinner, coffee, matcha, bakery, wine bar), line, source (https link) }`; each shows for about 60 days, retire one with POST `/api/admin/spot-notes/<id>/retire`. | Unset on /admin/launch. `/api/me/inspiration` shows today's cards and today's date. |
| `ENCORE_TZ`, `PM_TZ`, `PM_CRON` | No | The default time zone, and the schedule of the weekday morning job (`off` turns it off). |
| `ENCORE_DIRECTORY_CACHE_MS`, `ENCORE_INSIGHTS_CACHE_MS`, `ENCORE_LEADERBOARD_CACHE_MS`, `ENCORE_LEADERBOARD_OBSERVE_MS` | No | How long some pages cache their numbers. |
| `ENCORE_CSP` | No | `report` makes the content security policy report-only (for debugging). |
| `ENCORE_INLINE_APP` | No | Serves the app as one file (debugging). |
| `ENCORE_LEGAL_NAME`, `ENCORE_LEGAL_ADDRESS`, `ENCORE_TAX_ID` | Recommended for brands | Your company's name, address and tax id on invoices and legal pages. |
| `ENCORE_APPROVER_ROLES`, `ENCORE_ONE_APPROVAL_PER_PERSON` | No | Who approves plans in a team workspace, and one approval per person. |
| `ENCORE_ALLOW_DEMO_WRITES` | No | Lets the sample hosts take requests (demos only). |
| `ENCORE_MCP_TOKEN`, `ENCORE_MCP_TOKENS` | No | Tokens for the MCP API. |
| `ASSET_MAX_MB`, `MOMENT_VIDEO_MAX_MB`, `MOMENT_UNREAD_VIDEO_MB` | No | Upload size limits. |
| `ENCORE_COMMIT`, `RENDER_GIT_COMMIT`, `SOURCE_VERSION`, `VERCEL_GIT_COMMIT_SHA` | No | The app version on tickets and error reports. Render sets `RENDER_GIT_COMMIT` on its own. |
| `ENCORE_SSO_ALLOW_LOCAL` | No | Tests only: lets SSO settings point at private addresses. |
| `ENCORE_BRAND_FIXTURES` | No | Tests only: sample brand research files. |
| `HUBSPOT_TOKEN`, `HUBSPOT_EVENT_ORGANIZER` | No | HubSpot sync for brand workspaces. |
| `SF_ACCESS_TOKEN`, `SF_INSTANCE_URL`, `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_API_VERSION` | No | Salesforce sync for brand workspaces. |
| `SLACK_BOT_TOKEN`, `SLACK_DEFAULT_CHANNEL`, `SLACK_WEBHOOK_URL` | No | Slack posts for a team workspace. |
| `LINEAR_API_KEY`, `LINEAR_TEAM_ID` | No | Linear issues from the planner. |
| `NODE_TEST_CONTEXT` | No | Set by the test runner; never set it. |
| `ENCORE_FAKE_EMAIL`, `ENCORE_FAKE_SMS`, `ENCORE_FAKE_AI`, `ENCORE_FAKE_PUSH`, `ENCORE_FAKE_OAUTH`, `ENCORE_FAKE_GEO`, `ENCORE_FAKE_CRM`, `ENCORE_FAKE_WEBHOOK` | Never in production | Test switches: nothing real is sent. |
