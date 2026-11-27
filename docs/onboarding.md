# Onboarding with Potto (/onboard)

The idea: a busy shop owner gets their brand packages and their page set up in a few minutes. Potto asks a few questions, reads what the owner already has, drafts the packages, and puts nothing on the page until the owner taps **Looks good**.

## The steps

1. **Questions.** Six of them, one at a time, and any can be skipped: what you sell, what brands ask for, prices, group sizes, notice needed, and where you travel.
2. **Your material.** Upload a PDF, .txt or .eml file, paste an email or quote, or add a website or Instagram link. Gmail also shows up here once the server is set up for it (see below).
3. **Packages.** These are draft experiences (price, people, length, what's included, run of show, travel) and draft gift sets (price each, order size, price breaks, lead time, shipping, what can be personalized). Each draft shows where it came from and what's missing. Owners can edit any draft inline or remove it. **Looks good** publishes the drafts through the same `setProfile` limits the page editor uses.
4. **Your page.** Potto suggests a tagline, bio, color, cover, type and background, with a live preview. Each suggestion takes one tap to use, or **Use all** takes them all.
5. **Past events.** Paste links from Partiful, Luma, Eventbrite or any site. Each link becomes a draft card the owner can edit or remove, then **Add to my portfolio** saves them. This step calls `POST /api/host/scrapbook/preview` and then `POST /api/host/scrapbook/add`. If a server doesn't have those endpoints, it falls back to the older `/api/host/scrapbook/import`. The `Portfolio` adapter in `public/onboard.html` keeps the paths in one place.
6. **Reminders.** A phone number, text and email switches, what to be told about, and a switch to turn them all off.

Progress is saved as the owner goes (`onboard/draft`), so they can stop and come back.

`/onboard?preset=<name>` loads a prepared page (for example `le-phin`) straight into step 3, so the owner only has to confirm it. `/onboard#reminders` opens the reminder settings. Reminder emails link there.

## Voice and dictation

Every text box is a normal `<textarea>` or `<input>`, so macOS/iOS dictation, Android voice typing and Wispr Flow type into them like a keyboard does. The boxes are large and grow as text comes in. Nothing blocks pasting, and there are no `maxlength` caps (the server trims what it stores). Where the browser supports the Web Speech API (Chrome, Edge, Safari), each box also gets a mic button. Where it doesn't, the button is hidden.

## How drafts are made

- **With `ANTHROPIC_API_KEY`:** Claude drafts the packages from the answers and the material, using the existing `complete()` helper in `server/ai.js`. Any price Claude returns that doesn't appear in the owner's own words is removed and flagged "Add a price". Potto never invents a price.
- **Without a key, or with `ENCORE_FAKE_AI=1`:** a deterministic parser in `server/onboard.js` reads prices ("$12 a person", "$45 each", "50+ $40"), group sizes, lengths, lead times, bullet lists, run-of-show lines, travel and shipping. It also folds the owner's answers into matching drafts. The parser is also the fallback when Claude fails.

**PDFs.** The browser reads them with pdf.js 3.11.174 (the pinned UMD build) from cdnjs. To allow this, `/onboard` sends its own Content-Security-Policy, which adds `https://cdnjs.cloudflare.com` for scripts and workers on that page only. If pdf.js can't load, the PDF goes to `POST /api/onboard/pdf`. That route has a dependency-free reader that inflates content streams and uses each font's ToUnicode map, so Vietnamese text comes through. Scanned PDFs have no text layer, and the owner is asked to paste their prices instead.

**Links.** `POST /api/onboard/link` reads public https pages only. It refuses private or internal addresses, checks each redirect hop again, and stops after 8 seconds or 1.5 MB. Instagram often hides profiles from robots, and when it does the owner is asked to paste the text instead.

## Gmail (optional, set up by the server owner)

Gmail is hidden completely unless both of these are set:

| Variable | What it is |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client ID from Google Cloud Console (APIs & Services → Credentials → OAuth client, type "Web application"). |
| `GOOGLE_CLIENT_SECRET` | That client's secret. It stays on the server and is never sent to the page. |
| `GOOGLE_REDIRECT_URI` | Optional. Defaults to `<ENCORE_PUBLIC_URL or request origin>/api/onboard/gmail/callback`. Add the exact URL under "Authorized redirect URIs". |

In Google Cloud:

1. Enable the Gmail API.
2. On the OAuth consent screen, add the scope `https://www.googleapis.com/auth/gmail.readonly`. This is the only scope requested.
3. While the app is unverified, add test users. Gmail read-only is a restricted scope, so Google requires verification before the general public can use it.

What owners get:

- **Connect Gmail** with read-only access.
- A search box, prefilled with `quote OR pricing OR catering OR invoice newer_than:2y`.
- Up to 15 results to tick. Only the emails they tick are read.

Tokens are stored encrypted with AES-256-GCM, using a key derived from `SESSION_SECRET`. **Disconnect** revokes the token and deletes it.

The UI never asks anyone for a key or secret. Without these variables, owners still have paste and .eml upload: forwarding an email to themselves and saving it as a file works.

## Reminders (`server/reminders.js`)

`runPottoReminders` checks every host who takes brand work, once an hour. It doesn't run under `node --test`. It sends one message per run that lists everything due:

- **A brand request with no quote**: after 4 hours, and again the next morning (8am to noon local). After that, Potto stops. Requests older than 14 days are skipped.
- **A quote the brand accepted** (in the last 3 days): what's still due. That can be the deposit, the start time, the address, or for gifts, the names and artwork.
- **The day before a booked event**: a short checklist with the start and setup time, the address, the headcount, what to pack (from the package's "includes") and the brand contact.

**Channel.** Potto texts through `sms.js` (Twilio, or `ENCORE_FAKE_SMS=1`) when the owner gave a number and texting is on. Otherwise it emails the workspace owner through `email.js`.

**Quiet hours.** No texts from 9pm to 8am in the owner's time zone. The browser sends the zone when settings are saved, and `ENCORE_TZ` is the fallback. When texting is the owner's channel, anything due overnight waits for the morning text.

**Opt-out.** Owners can turn off all reminders or just one kind. Replying STOP to any text stops texts (the `sms.js` stop list). Every email links back to `/onboard#reminders`. When an owner first turns on texts, Potto sends one confirmation text.

Each reminder is recorded under `potto/<request>-<kind>`, so it is never sent twice.

## Environment variables in one place

- `ANTHROPIC_API_KEY`: optional. Claude drafts packages. Without it, the parser does.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`: optional. Gmail.
- `ENCORE_TWILIO_SID`, `ENCORE_TWILIO_TOKEN`, `ENCORE_TWILIO_FROM`: texts (already used elsewhere).
- `ENCORE_EMAIL_SERVICE`, `ENCORE_EMAIL_KEY`, `ENCORE_EMAIL_FROM`: email (already used elsewhere).
- `ENCORE_PUBLIC_URL`: links in reminder texts and emails.
- `ENCORE_TZ`: fallback time zone for quiet hours.
- `ENCORE_SUPPORT_EMAIL`: optional. Comma list of team addresses that get an email for every "Talk to a person" message, with a link to it in the team inbox. Sent through the default email service (`ENCORE_EMAIL_*`), so set that up too.
- `ENCORE_SUPPORT_SMS`: optional. Comma list of phone numbers (E.164, like `+15551234567`) that get a short text for every message. Needs Twilio (`ENCORE_TWILIO_*`).
- `ENCORE_ADMIN_EMAILS`: comma list of the accounts that can open the team inbox at `/support` and reply. Everyone else gets a 404 there.

## Help: "Need a hand?" (`public/help.js`, `server/help.js`)

Every signed-in page, and every onboarding step before the account exists (`/signup`, `/login`, `/forgot`, `/reset`, `/join`, `/onboard`), has a **Need a hand?** button in the bottom corner. It sits above the phone tab bar and any button already fixed at the bottom right (Edit page, Shop), and moves to the top left when a full-height dialog leaves no room. Escape closes the panel.

- **Potto** answers from `docs/help.md`, which is the whole knowledge base: keep it true to the product. With `ANTHROPIC_API_KEY`, Claude answers in 1 to 4 short sentences from the guide, given the host's handle, what their page still needs, the page they're on and the open event's title and status (never a guest's name, email, phone or reply). Without a key, the best-matching section of the guide answers. Signed in: 30 questions an hour per person (`ENCORE_HELP_PER_HOUR`). Signed out, on the onboarding pages only: 10 an hour per IP (`ENCORE_HELP_PER_HOUR_IP`).
- **Talk to a person** is always visible. Signed in, the reply goes to the account email (and an optional phone); signed out, an email is required. The page, the event, the browser, the app version and the chat with Potto are attached. A hidden honeypot field and per-IP limits keep bots out. Messages are stored under `system/support-<id>` with status open, waiting or solved. With neither `ENCORE_SUPPORT_EMAIL` nor `ENCORE_SUPPORT_SMS` set, they're still stored and show at `/support`.
- **Replies** from `/support` reach the host as an in-app notification, an email (when email is set up) and under **Your conversations** in the help panel.
- **Potto offers help once a session** ("Stuck? I can help, or get you a person.") when someone stays on a sign-up, onboarding, wizard, page-setup or share step for 60 seconds without moving on, sees the same error twice, or signup fails because of a host code or an email already in use.
- `ENCORE_SIGNUP_PER_HOUR`: sign-ups and invite joins allowed from one IP address per hour. Default 20, so a class or a party on one wifi network can all start pages. Raise it for a big in-person launch.
- `ENCORE_ADMIN_EMAILS`: comma-separated emails that may read the funnel at `/api/admin/funnel`. Everyone else gets a 404.
- `ENCORE_POSTHOG_KEY`, `ENCORE_POSTHOG_HOST`, `ENCORE_POSTHOG_REPLAY`, `ENCORE_ANALYTICS_SALT`: product analytics with PostHog, off unless the key is set. See `docs/analytics.md`.
- `ENCORE_LEGAL_NAME`, `ENCORE_LEGAL_ADDRESS`: the company name and address shown on `/privacy` and `/terms`. Without them the pages say "Pottery Lab" and show no address.

## Sign-up limits behind Vercel

The sign-up limit counts per IP address. Render passes the visitor's real IP in `X-Forwarded-For`, and `ENCORE_TRUST_PROXY=1` (set in `render.yaml`) tells the server to read it. Leave that setting as it is.

Traffic that comes through the Vercel rewrite (`vercel.json`) is different: Vercel makes the request to Render itself, so the IP the server reads is Vercel's, not the visitor's. Every visitor who comes in that way shares one IP, and after `ENCORE_SIGNUP_PER_HOUR` sign-ups in an hour, everyone else on that path sees "Too many sign-ups from here." The login limit has the same problem.

The fix is to point the custom domain straight at Render, with no Vercel in between. Follow `docs/domain-switch.md`: add the domain in Render's Custom Domains, create the DNS records Render shows, and keep the Vercel project only as a fallback for the old address (or remove its domain). Until then, a higher `ENCORE_SIGNUP_PER_HOUR` keeps the shared IP from blocking real people.

## Funnel metrics

`server/metrics.js` records one row per step, with a timestamp, the workspace id and the event id. No names, emails or phone numbers. The steps: `signup` (with the `ref` event and whether a host code was used), `first_event_created`, `share_clicked` (the app sends it when a host taps Share invite), `first_reply`, `three_replies`, `event_done`, `kudos_received`, `guest_follow` and `guest_became_host`.

`GET /api/admin/funnel` (signed in as an email in `ENCORE_ADMIN_EMAILS`) returns each step's count overall and for the last 7 and 30 days, and activation: hosts who shared an event and got 3 or more replies from guests within 7 days of signing up.

## Guests who become hosts

When hosting is invite-only, a guest can still start a page without a host code if they sign up from an event they came to (`/signup?mode=friends&ref=<event id>`, the link on the "You're in" screen and the kudos thanks screen) and either replied I'm in to it with the same email or sent it kudos. The new workspace records `vouchedBy`, its audit log says so, and the server logs a `[signup] vouch` line.
