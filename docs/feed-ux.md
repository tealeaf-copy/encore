# Feed UX: Watching, Friends and the city picker

The owner asked three things from an iPhone: how do I know an alert is working, why doesn't Friends work, and
make the city picker easy on the go. This is the critique from walking each one at 390px and 1280px on a seeded
server, what we changed, and why.

## What we found

### Watching (alerts)

- The tab was a text box and a list of one-line summaries. Nothing said whether an alert was on, when we last
  looked, or what it had found. After saving, the only proof was one line of grey text that disappeared on the
  next draw.
- The summary was internal words: "cook events, in Brooklyn and open to the public".
- "In my city" and "near me" were not understood. The page never sent the city you had picked, so "free game
  nights in my city" quietly matched game nights anywhere. A lowercase city ("runs in austin") was missed the
  same way.
- Matching only ran when a host saved an event through the editor. An event made public any other way was
  never checked, and there was no hourly sweep to catch it.
- No way to pause, edit, choose email or phone per alert, or see a sample notification.

### Friends

- If someone added you, nothing on the Friends tab said so. The bell note linked to their host page, where the
  button follows them as a host, so there was no way to add them back. This is the main "not working".
- After you tapped Add, "Your friends" still said "No friends yet." until you left the tab and came back.
- Links to `/feed#friends` (and `#alerts`) did nothing when you were already on the feed: the page only read the
  hash on load.
- The tab showed names only, not what friends were going to or hosting, and the search showed full names and
  ignored blocks (it used an older endpoint, not the one Find people uses).

### City picker

- On the feed, "Change" swapped the header for a text field with a datalist and a Save button. On Discover, the
  city button opened a panel with a text field, "Show events", "Use my location" and "Anywhere". Hosts and Events
  used a native select. Four different pickers, all built around typing.
- "Use my location" often said "Couldn't get your location" when it had a fix: a stale manual choice won over
  the GPS answer, anywhere 120+ miles from a built-in city counted as failure, and every error had the same
  message.
- Picking "Anywhere" did not stick: on the next load the page saw an empty city and put your workspace city back.
- The feed asked for location permission on first load, before anyone tapped anything.

## Recommendations (all built)

1. **One picker everywhere.** `EncorePlace.sheet()` in `public/place.js`: a bottom sheet on phones, a small popover
   by the button on desktop. Used by the feed header, Discover, Hosts and Events.
2. **No typing first.** Order: Use my location, Recent (your last four), Where events are (cities with open
   events, busiest first, from `/api/public/places`), Anywhere, then a search field with suggestions as you type.
   A tap applies at once and closes. No select, no datalist, every target 44px or taller.
3. **Location that tells the truth.** A tap always uses the phone's answer. Far from every known city, we say so
   and offer the three closest. Each failure says what happened (location off, with the iPhone Settings path;
   took too long; phone couldn't find it; browser can't; page not secure). No prompt until you tap.
4. **The choice is remembered and visible.** The feed says "Showing San Francisco · Change" as one button, updates
   in place, and Anywhere is a real choice that survives a reload.
5. **Watching shows its work.** Each alert is a card: what it watches (what, where, when, price), On or Paused,
   "Nothing new yet" or "2 new matches this week", what is coming up right now, the last thing it told you, and
   when we last checked (every hour and each time a host posts).
6. **Proof on demand.** "Send me a test" drops a sample in the bell (and on the phone when the app is installed)
   and rings the bell icon, so you can see where alerts land.
7. **Control per alert.** Switches for email and phone notifications (the bell is always on), Pause, Edit,
   Delete. Right after you start watching, the card shows what already matches, with a toast.
8. **Matching that can't miss.** The on-save check plus an hourly sweep, with a per-alert list of events already
   shown so nothing arrives twice and nothing already on is announced as new. "My city" uses your picked city.
9. **Friends you can act on.** "Added you" requests at the top with Add back and Not now; the bell note opens it.
   Your friends show what they are hosting, going to and their latest kudos. Find friends uses the same search
   as Find people (first names, blocks respected) and links to it for Suggested, Contacts and your QR code. A
   clear empty state.
10. **The tab is in the address.** `#alerts` and `#friends` switch tabs on the page, from the bell or Back.

## Where it lives

- `public/place.js`: `locate`, `useGps`, `sheet`, `chip`, recent cities.
- `public/feed.html`: Watching and Friends tabs, the header chip styles, hash handling.
- `public/discover.html`, `public/hostdir.html`, `public/events.html`: the city button opens the sheet.
- `server/social.js`: alert parsing and summaries, `sweepAlerts` (hourly, in `runJobs`), `PATCH` and `/test` for
  alerts, `GET /api/me/friends`, `POST /api/me/friends/ignore`, `GET /api/public/places`.
- `server/push.js`: a bell item marked `nopush` (an alert with phone off) is not pushed.
- Tests: `test/place-gps.test.js`, `test/feed-watching-friends.test.js`, `test/city-sheet.test.js`.

## Not verified here

Real pushes on an iPhone and the real iOS location prompt were not tested; both are stubbed (fake push outbox,
Playwright geolocation, a stubbed `navigator.geolocation`).
