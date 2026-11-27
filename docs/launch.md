# Launch kit: first 5 hosts and 50 guests

Live app: https://encore-2qzx.onrender.com

## Before you invite anyone (5 minutes, in Render)

- **Email.** Check that the email settings are in place so magic links, RSVP confirmations and "someone followed you" emails go out.
- **Texting (optional).** Add `ENCORE_TWILIO_SID`, `ENCORE_TWILIO_TOKEN` and `ENCORE_TWILIO_FROM` to turn on RSVP by text. Without them, hosts still send invites from their own phone using the Text and WhatsApp buttons; the reply link works either way.
- **Sample hosts.** Discover marks the seeded demo hosts as "Sample event" and shows them after real events. To hide them completely once real events are up, set `ENCORE_HIDE_DEMO=1`.
- **Example hosts for brands.** Every deployment ships about 70 made-up hosts for the brand side (server/brandexamples.js): private chefs, matcha and coffee pop-ups, bakeries, florists, yoga and sound baths, venues, caterers, photographers, event staff and summit planners in New York, San Francisco, Los Angeles, Austin, Chicago, Seattle, Boston and London. They show only in /teams pages (Discover, Quick book, experience pages, shortlists, compare), always tagged "Example", and they can't be booked: the last step offers "Ask us to find a real host for this", which lands in the contact messages as `find-host`. Real hosts always rank first, and examples only fill Quick book when fewer than 3 real hosts fit. They are never workspaces, so they never show in host leaderboards, the public Discover, city counts or any metric. `ENCORE_HIDE_DEMO=1` hides them too.
- **Deploys.** Each deploy takes the site down for about a minute, so don't deploy while hosts are onboarding.

## The 5 hosts

1. Send each host the signup link and the founder code: https://encore-2qzx.onrender.com/signup, code **OINKOINK** (reusable). They should pick "Friends" when asked.
2. Ask each one to post one real get-together in the first session. The wizard takes about 3 minutes, and offering a date poll is fine if they haven't settled on a date.
3. On the **Guests** step, "Invite these first" says to start with the 3 surest yeses. Once a host has history, Pip ranks their early birds there.
4. Then they share the link more widely, by text, WhatsApp, Instagram story or email. **Guests don't need a code to RSVP.**
5. Each host gets 10 invite codes, plus 10 more after every event where at least 3 people said yes. Codes are only needed for someone who wants to host.

Message to send a host:

> I'm onboarding 5 hosts to Encore this week, a small app for hosting get-togethers with friends. Sign up here with the code OINKOINK: https://encore-2qzx.onrender.com/signup. Post your next dinner or game night (about 3 minutes), send it to your 3 surest yeses first, then share it wider. Your friends can RSVP by link with no account needed. Can you have one up by Friday?

## The 50 guests and explorers

- Guests arrive through a host's link and RSVP with a name and email. They don't need an account or a code.
- Explorers start at **/discover** (events near them) and **/quiz** (their guest type, which they can share).
- Anyone can sign up to follow hosts without a code. Only hosting needs a code.

Message to send explorers:

> Find out what kind of guest you are (it takes a minute): https://encore-2qzx.onrender.com/quiz. Then see what's on near you: https://encore-2qzx.onrender.com/discover

## What to watch in week one

- Hosts who post an event within 24 hours of signing up (goal: 5 of 5).
- RSVPs per event (goal: 6 or more), and the share of the first 3 that come from the "Invite these first" list.
- Guests who take the quiz or follow a host after RSVPing.
- Anything that breaks: ask hosts to screenshot it and send it to you directly.

## Backups and disk

The database and uploads live on the Render disk (`render.yaml`, 10 GB, mounted at `/app/data`).

- **Render snapshots.** Render snapshots persistent disks once a day (check Render's disk docs for how long they're kept on your plan). Restore one from the service's **Disks** tab. A restore puts back the whole disk, so it rolls back everything written since.
- **A nightly copy you control.** Snapshots stay inside Render. Once a night, also make a clean copy of the database with SQLite's `VACUUM INTO`, which works while the server is running and writes one consistent file. From the service's shell (the image has Node and better-sqlite3, not the sqlite3 CLI):
  `mkdir -p /app/data/backups && cd /app && node -e "require('better-sqlite3')('/app/data/encore.db').exec(\"VACUUM INTO '/app/data/backups/encore-\" + new Date().toISOString().slice(0, 10) + \".db'\")"`
  Copy the file off Render (for example to S3 or Backblaze), and delete copies older than 30 days so the disk doesn't fill. Uploads are files in `/app/data/assets`; copy that folder too.
- **Check it.** Once a month, open a copy and count the rows (`SELECT count(*) FROM docs`) to make sure it isn't empty.
