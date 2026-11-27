# The About page story

What /about (public/home.html) says, and why. Voice and words follow `docs/brand-kit.md`.

## The spine

Every good night out has a host behind it. They pick the menu, borrow the chairs, chase the group chat for a head
count, send the address twice and then the payment requests, and start again next month. The people who make a city
feel alive do a lot of work nobody sees, and the tools they have were made for selling concert tickets or planning one
birthday party, not for running the same supper club every month. Pottery Lab is built for that host. It makes the job
easier, it makes the thanks visible, it gets them paid, it turns guests into regulars, and it helps strangers and brands
find them. Guests get a place to explore, discover and plan in-person events with the people they love. Brands get trusted,
experienced hosts and a booking they can run end to end.

## Positioning lines (owner, Nov 2026)

- **Everyone:** "Pottery Lab is where you go to explore, discover and plan out your in-person events and experiences
  with the people you love." The For guests column carries it word for word, and the close echoes it.
- **Brands:** where brands find trusted, experienced hosts, learn what kinds of experiences resonate with their
  buyers, and run campaigns end to end. The For brands column names what is built (Discover by mood and occasion, the
  Trusted host badge, Quick book, campaigns from the brief to the report) and insights with their privacy rule (a
  number shows only with at least 10 people and 3 events behind it, `K` in server/insights.js).

## Hero, narrative first (owner, late Nov 2026)

The owner said the hero still didn't land: it had to open on a scene or a feeling the reader recognizes in themselves,
so they think "this is for me" before they know what the product is. Five options:

1. **The friend who always plans (live).**
   You're the one who always makes the plan.
   You pick the date, chase the replies and send the address twice. Pottery Lab does that part for you, so you get to enjoy the night too.
2. **The group chat.**
   The group chat says "we should" every month.
   Eleven hearts and two replies is not a plan. Write one sentence, Potto drafts the invite, and your friends reply I'm in with one tap.
3. **The would-be host.**
   You'd host more if it were only the fun part.
   The cooking, the playlist, the people. Not the head count, the reminders or the nine payment requests. Pottery Lab takes those, and you keep the night.
4. **The night a city felt like home.**
   One good night can make a city feel like home.
   Six strangers at a table, a run that ends at a bakery, a game night where you learned everyone's name. Pottery Lab helps you host that night, or find it.
5. **Small nights.**
   Small nights, with people you'll see again.
   A table of six, a Sunday run, a hack night with friends of friends. Pottery Lab is where you plan them and find them, without the admin.

**The pick: 1.** It names a role the reader already plays in their friend group, so they see themselves in the first
line, and the deck ends on what they never get to do (enjoy the night). Guests know that friend too. 2 is the close
second but repeats the MON line of the week below. 4 is warm but reads as a slogan, and 5 describes the product before
it describes the reader.

Retired: "Every good night out starts with a host." (said the point but nobody saw themselves in it), "Somebody
carried the chairs." (too abstract), "Hosts do the work. They should get the credit.", "For the one who started the
group chat."

## The primary action

Every primary button on the page reads "Plan your first event" and goes to /start. Not everyone wants to plan a
dinner. Signed in (the `encore_in` cookie hint the shell also reads), the same buttons read "Plan an event". The shell
says the same thing: the signed-out tab and the "New here?" line on the feed. /start keeps "Plan a dinner" as its own
heading because its default template is a dinner and the heading changes with the template.

## Section order (one story)

1. Hero: WHY WE EXIST, the friend who always makes the plan, Plan your first event and Explore what's on.
2. 01 The night: one good night takes a week, day by day.
3. 02 The problem: the work nobody sees, and tools made to sell tickets to strangers. Then the team's own pull quote.
4. 03 For hosts: "So we took that week apart." Four pillars, all built today (less admin, rewarded, a following, found).
5. 04 Who it's for: hosts (start with one event), guests, brands with insights. Then what's on right now.
6. 05 Community rules, in this order:
   - **Trust and quality over quantity.** Eight people you'll see again beat eighty you won't. Hosts make the night, and guests send kudos and an honest note, so every night makes the next one better for all of us.
   - **Safety first.** Your events are private unless you list them, and only guests who are in get the exact address. You can report or block wherever you see something, and we look at every report within 24 hours.
   - **Made for you.** Pick what you're into and follow the hosts you like, and your feed shows those first. Potto drafts invites and sends reminders, so you spend less time planning and more with the people you love.
   - Under them: "No ads. We don't sell ads or your guest list." and the tagline, word for word.
7. The close, one line that answers the hero ("This time, let Pottery Lab chase the replies.") and one step per
   reader: Plan your first event (/start), Find something this weekend (/feed), Book a host for your team (/teams/discover).

What the rules rest on: invites are link only and show on Discover only when listed; for host events the exact address
goes only through the RSVP-checked address endpoint (server/app.js); report and block live in server/safety.js, which
answers "We look at every report within 24 hours"; kudos and the private "what to try next" note; the "What are you
into?" picker (public/interests.js, interests and a city) and follows order the feed (server/feedvisual.js,
server/feedblend.js). The guest quiz does not change the feed, so the page doesn't say it does. "Curated" is off the
word list, so the page says what happens instead.

## The Nov 2026 edit

The page was about 1,050 words. It is now under 600, about two minutes. Cut: the list of event types in the problem
section, the fifth pillar (thanks folded into "A following"), bullets that repeated each other (stats, streaks, brand
kit, imports, flyers, QR codes, tips, wishlists, packages), the hosts card's feature list (the pillars say it), three
beliefs that restated the pillars, and "What we believe" as a heading. Insights and campaigns are built now, so the
"Coming soon" label is gone and the brands card names Quick book, campaigns and the insights threshold instead.

## Left out on purpose

- Card payments inside Pottery Lab. Guests pay through the host's own pay link (Venmo, PayPal, Cash App or a Stripe
  link); there is no built-in Stripe checkout, so the page doesn't claim one.
- Paid supporter tiers. Pledges record a tier and charge no one, so the page says tips and a supporter link.
- The invite planner and People, which aren't on main yet.
- Fees and take rates, numbers of hosts or guests, logos and quotes from real people.
