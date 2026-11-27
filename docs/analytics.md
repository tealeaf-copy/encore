# Analytics (PostHog)

Pottery Lab can send usage counts to PostHog. It is off unless a key is set: with no key, no script is added to any
page, the Content-Security-Policy is unchanged, and the server sends nothing.

Code: `server/posthog.js` (server sender, allow-list, page tag, CSP), `public/plcount.js` (browser loader and the
one-time notice). Tests: `test/posthog.test.js`.

## Turning it on (Render)

| Variable | Default | What it does |
|---|---|---|
| `ENCORE_POSTHOG_KEY` | unset | The PostHog **project API key** (starts with `phc_`). It is public by design and ends up in page HTML. Never put a personal API key (`phx_`) here: anything that doesn't start with `phc_` is ignored. |
| `ENCORE_POSTHOG_HOST` | `https://us.i.posthog.com` | The PostHog host. EU cloud: `https://eu.i.posthog.com`. Must be https. |
| `ENCORE_POSTHOG_REPLAY` | `0` | `1` turns on session replay for people who said OK. Even then every input and all text is masked. |
| `ENCORE_ANALYTICS_SALT` | `SESSION_SECRET` | Salt for the hashed ids. Leave it unset so experiment rows (which use the same hash) join the host they belong to. Changing it starts everyone over as new people in PostHog. |

On Render: Dashboard, the service, Environment, add `ENCORE_POSTHOG_KEY` (and `ENCORE_POSTHOG_HOST` for an EU
project), save, and let it redeploy.

## PostHog project settings to turn on

- **Discard client IP data** (Project settings, General). This is what keeps IP addresses out. The browser also sends
  `$ip: null` and both sides send `$geoip_disable: true`, but the project setting is the one that counts.
- **GeoIP**: leave the GeoIP app off (or keep `$geoip_disable`), so no city is worked out from an IP.
- **Session replay**: keep it off unless `ENCORE_POSTHOG_REPLAY=1`. If you turn it on, also set "Mask all inputs" and
  keep "Capture console logs" and "Capture network" off.
- **Autocapture, heatmaps, web vitals, surveys, exception autocapture**: off (the page turns them off too).
- **Authorized URLs** for the toolbar: only your own domain.

## Consent

- The first visit shows a small notice: "We count visits to improve Pottery Lab. No ads, no selling data." with OK
  and No thanks. The answer is kept in this browser (`localStorage` key `pl-count`).
- Nothing from PostHog loads before OK. No thanks, Do Not Track or Global Privacy Control mean no browser analytics.
- Signed in: Settings, "Help improve Pottery Lab (anonymous usage counts)". It shows only when PostHog is set up, and
  it's on unless they said No thanks. Turning it off stores an opt-out for their workspace's hashed id
  (`system/analytics-off-<hash>`), which also stops the server-side events for that workspace.
- The privacy policy (`/privacy#analytics`) says what is counted and how to opt out.

## Ids

`distinct_id` is `HMAC-SHA256(salt, workspace id)`, first 16 hex characters. The browser gets the same hash from
`GET /api/me/analytics` and calls `identify` with it, so browser and server events join. Never an email or a name.
`person_profiles: "identified_only"`: signed-out visitors get no person profile. Server events with no signed-in
actor (a guest following a host, say) use a random id and `$process_person_profile: false`.

## What is sent

Every server event carries `source: "server"`, `$ip: null`, `$geoip_disable: true` and, when known, `plan`
(`friends` or `work`). Only these properties can be sent, each checked for shape (anything else is dropped):

- `step` (a funnel step name), `plan`, `answer` (going, maybe, no, waitlist, requested), `method` (email_code,
  phone_code, email_link, passkey, google, apple, password, sso)
- `kind`, `via`, `exp`, `variant`, `goal`: short plain words (no `@`, no long digit runs)
- `count`, `guests`, `results`: whole numbers
- `code`, `first`, `signed_in`, `private`, `paid`: true or false
- `region`: a city at most, and only one the app already knows (server/geo.js), sent by its own name

Server events:

| Event | When | Properties |
|---|---|---|
| `signup`, `first_event_created`, `share_clicked`, `first_reply`, `three_replies`, `event_done`, `kudos_received`, `guest_follow`, `guest_became_host` | each funnel step (server/metrics.js) | `step`, `code`, `via` |
| `signup_completed` | a new account | `method`, `code` |
| `signed_in` | any sign-in | `method`, `first` |
| `xp_exposure`, `xp_conversion` | experiment rows (server/experiments.js) | `exp`, `variant`, `goal`, `$feature/<exp>` |
| `event_published` | an event is published | `kind`, `region`, `private` |
| `reply_received` | a guest replies or changes their reply | `answer`, `first`, `kind` (drop) |
| `drop_order_placed` | a drop order | `count` (lines) |
| `kudos_given` | kudos from a guest, a group link or the feed | `kind`, `count` (tags) |
| `comment_posted` | a feed or shortlist comment | `kind` |
| `chat_message_sent` | a group chat message or photo | `kind` |
| `follow` | following a host | `kind`, `signed_in` |
| `fanclub_joined` | joining a fan club | `signed_in` |
| `brand_quickbook_searched` | a quick book search | `guests`, `goal`, `results` |
| `brand_request_sent` | a booking request | `guests` |
| `inspiration_shown`, `inspiration_tapped`, `inspiration_dismissed` | an inspiration card in the feed half on screen, its Plan this, its Not for me (server/inspiration.js) | `via` (calendar, new_here, team, provider, prompt), `kind` (holiday, observance, season, watch, spot, city), `goal` (the moment, like friendsgiving, or the category, like matcha), `signed_in`, `region` |
| `inspiration_planned` | an event saved from an inspiration card's Plan this (it carries `inspiredBy`) | `via`, `kind`, `goal`, `region` |

Browser events: `$pageview` (also on in-app navigation), `$identify` for signed-in people, and `$snapshot` only with
replay on. Anything else is dropped in `before_send`. URLs keep the path only: query strings and #hashes go, and path
parts that look like tokens (`/reconfirm/...`, `/survey/...`, `/l/...`, `/k/...`, `/p/...`, `/plans/feed/...`, anything
over 20 characters or with `@`, `.`, `=` or a long digit run) become `:token`. `/e/<id>` and `/@handle` stay. External
referrers keep only their origin. Page titles, campaign params (`utm_*`, `gclid`, ...) and element text are dropped.

## What is never sent

Names, emails, phone numbers, addresses, free text (comments, chat messages, notes, answers, kudos words), event
titles, event or RSVP ids, RSVP codes and tokens, query strings and hashes, IP-derived location.

## Sender

Events queue in memory and go to `${host}/batch/` every 10 seconds or every 50 events, with a 5 second timeout. A
failed batch is dropped (no retries), the queue holds at most 1000, and nothing waits on PostHog. `/admin/brand-metrics`
shows whether PostHog is connected and when the last batch was sent (`GET /api/admin/analytics`, admins only).
