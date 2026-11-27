# Owner setup to-do for the Dec 5 launch

Everything here is something only you can do: accounts in your name, approvals from other companies, and settings on Render.
Work top to bottom. The first block has the longest waits, so start it today.

Secrets (keys, tokens, passwords) go into Render's environment settings or the secure form, never into chat or a file
in the repo. Names marked "(confirm after merge)" come from work still in progress; the launch dashboard at
/admin/launch will show the final names and which ones are still missing.

## 1. Start today (approvals take days to weeks)

- [ ] **Twilio account** (texting: sign-in codes, Potto by text, urgent support texts)
  - Create the account, add billing, buy a US number. A toll-free number usually verifies faster than a local one.
  - Submit **toll-free verification** (or **A2P 10DLC** brand and campaign registration for a local number).
    Use case wording: "Event invites, RSVPs, reminders and sign-in codes for people who opted in. Replies to STOP and HELP."
  - Waiting time: often several days, sometimes 2 to 3 weeks.
  - Render: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (the number in +1 format, or a Messaging Service SID starting MG).
- [ ] **WhatsApp Business** (Potto by WhatsApp)
  - Easiest through Twilio (same account): request a WhatsApp sender. Or use Meta's WhatsApp Cloud API directly.
  - Complete **Meta Business verification** (legal name, address, website, documents).
  - Register the sender number and display name ("Pottery Lab").
  - Submit the message templates once we send them to you (reminders, "your event is tomorrow", replies arriving).
  - Waiting time: days to a few weeks. Render variable names: (confirm after merge).
- [ ] **Meta developer app for Instagram import** (optional for launch; the photo-and-bio import works without it)
  - developers.facebook.com: create an app, add "Instagram API with Instagram Login", set the redirect URL we give you.
  - Submit for App Review with a screen recording. Waiting time: one to several weeks. Not likely live by Dec 5.
  - Render: `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI` (confirm after merge).
- [ ] **Stripe** (paid memberships for hosts after 5 events)
  - Create the account, finish business verification and bank details, turn on **Connect** (Express accounts).
  - Add a webhook endpoint (URL from docs/memberships.md) and copy its signing secret.
  - Render: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, fee setting (confirm after merge). Without these, memberships stay off.
- [ ] **Apple Developer Program** (Sign in with Apple, the iPhone app later): $99/year, enrollment can take a few days.
  Then follow docs/sign-in-setup.md for `ENCORE_APPLE_TEAM_ID`, `ENCORE_APPLE_SERVICES_ID`, `ENCORE_APPLE_KEY_ID`, `ENCORE_APPLE_PRIVATE_KEY`.

## 2. This week (each takes under an hour)

- [ ] **Email sending** (sign-in codes, invites, reply summaries, support replies)
  - Pick a provider the app supports (see docs/sign-in-setup.md), verify your sending domain (SPF, DKIM records at your domain host).
  - Render: `ENCORE_EMAIL_SERVICE`, `ENCORE_EMAIL_KEY`, `ENCORE_EMAIL_FROM`, `ENCORE_EMAIL_FROM_NAME`.
- [ ] **Google sign-in**: Google Cloud console, OAuth client for the web; follow docs/sign-in-setup.md.
  Render: `ENCORE_GOOGLE_CLIENT_ID`, `ENCORE_GOOGLE_CLIENT_SECRET`.
- [ ] **PostHog** (product analytics): create a project (US or EU), copy the project API key (starts `phc_`).
  In project settings turn on "Discard client IP data". Render: `ENCORE_POSTHOG_KEY`, and `ENCORE_POSTHOG_HOST` only for EU.
- [ ] **Support inbox and phone**: decide the email and mobile that get help tickets and urgent "my event is today" texts.
  Render: `ENCORE_SUPPORT_EMAIL`, `ENCORE_SUPPORT_SMS`, `ENCORE_SUPPORT_REPLY_HOURS` (e.g. 12), `ENCORE_SAFETY_EMAIL`.
- [ ] **Anthropic API key** (Potto, drawn covers, Instagram import drafts): console.anthropic.com, create a key, set a monthly spend limit.
  Render: `ANTHROPIC_API_KEY`.
- [ ] **GIF search** (optional; built-in stickers work without it): a GIPHY or Tenor developer key. Render: (confirm after merge).
- [ ] **Map geocoder** (optional): `ENCORE_GEO_PROVIDER` (e.g. nominatim) and, for paid providers, `ENCORE_GEO_KEY`.

## 3. Render settings (core, required for launch)

- [ ] `ENCORE_PUBLIC_URL` = your live address (e.g. https://potterylab.com or the onrender URL until the domain is ready)
- [ ] `ENCORE_TRUST_PROXY` = `1`
- [ ] `SESSION_SECRET` = a long random string (keep it the same forever; changing it signs everyone out)
- [ ] `ENCORE_ADMIN_EMAILS` = your email (and anyone helping you run the launch)
- [ ] `ENCORE_INVITE_ONLY` = `1` for the cohort, and create invite code batches (host, guest, brand) from the admin page
- [ ] `ENCORE_SIGNUP` = `1`
- [ ] `ENCORE_LEGAL_NAME`, `ENCORE_LEGAL_ADDRESS` (shown in emails and terms)
- [ ] `ENCORE_TZ` = your main time zone (e.g. America/New_York)
- [ ] `ENCORE_HIDE_DEMO`: leave unset so brands see the example hosts; set to `1` only if you want them hidden
- [ ] **Persistent disk** for the database: make sure the Render service has a disk attached and `DATA_DIR` points to it, so data survives deploys
- [ ] **Backups**: turn on disk snapshots (or a daily export) and try one restore before Dec 5
- [ ] **Plan size**: a paid instance that doesn't sleep, so first visits aren't slow

## 4. Domain and trust (before inviting people)

- [ ] Custom domain on Render (e.g. potterylab.com), HTTPS on, then set `ENCORE_PUBLIC_URL` and `ENCORE_CANONICAL_HOST` to it
- [ ] Sending domain records for email (from step 2)
- [ ] Review the Terms and Privacy pages (/terms, /privacy) once PostHog, Stripe and Potto-by-text are described there

## 5. For the cohort (Dec 1 to 4)

- [ ] List of the 10 hosts, 10 field marketers and the 100 guests to invite (names and emails or phones)
- [ ] Invite code batches by role from the admin page
- [ ] Ask each of the 10 hosts for their Instagram (for the import) and their Venmo / PayPal / Cash App handles
- [ ] Pick the 10 launch events with the hosts (dates in December)
- [ ] A short welcome message for each group (we can draft these)

## 6. Later (after launch)

- [ ] iPhone app: App Store Connect listing, push keys (`ENCORE_APNS_*`), universal links (`ENCORE_IOS_BUNDLE_ID`)
- [ ] Android app: Google Play console, Firebase for push (`ENCORE_FCM_*`), app links (`ENCORE_ANDROID_PACKAGE`, `ENCORE_ANDROID_SHA256`)
- [ ] Brand CRM sync (optional): HubSpot or Salesforce tokens
