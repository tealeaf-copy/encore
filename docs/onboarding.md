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
