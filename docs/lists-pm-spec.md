# Lists people follow: the library on the feed

A short spec for turning the library's lists (public/library.html, server/library.js) into something a guest can share with friends, then make public and build a following with. Built in server/curation.js, server/listfeed.js, public/listcards.js, public/listpublic.js, public/curator.html and small hooks in the library, the feed blend, the host page, the event page and Discover.

The idea we take from the new professional networks that launched this fall: what you pick says who you are, and picks from people you trust beat picks from an algorithm. We take only the principles. Pottery Lab keeps its own words and the Field Notes kit.

## Goals

1. A guest's taste becomes visible and useful to others. Lists are already the best signal we have of what someone loves. Today they sit in a private library.
2. Friends discover through friends. "Maya made a list: Quiet dinners in Brooklyn" in the feed is a better reason to go than any shelf we can build.
3. A curator can build a following over time, in small honest steps: private, then friends, then public.
4. Hosts benefit when they are curated. Being on 14 public lists is proof a host is worth following, and it sends people to their page.
5. Nothing leaks. A private list, a friends list or a private event never reaches someone who could not already see it.

## User stories

**A guest curator (Maya)**
- I make "Quiet dinners in Brooklyn" and it starts Private. Nobody sees it.
- I set it to Friends. My friends see it in their feed once it has 3 things, and in "Shared with you" in their library.
- I add a line under each pick ("Order the dumplings, sit at the bar").
- 12 friends opened it. Pottery Lab asks once: "12 friends opened Quiet dinners. Make it public?"
- I make it Public. Before it goes, I see how it will look to a stranger, with any private event left out.
- My page (/@maya/lists) shows my public lists and my followers. My library shows a small strip: followers, saves of my lists, and how many people went to something from my lists.

**A friend browsing (Ben)**
- In my feed: "Maya made a list: Quiet dinners in Brooklyn (8)" with the first covers. One tap follows the list, one tap saves it to my library, and kudos and comments work like any other card.
- Later: "Maya added Dumpling Night and Sunday Pasta to Weekend ideas", once that day, not once per add.
- I went to Dumpling Night, so on Maya's list I can tap "I'd go again". The item now says "3 would go again, including Ben".
- I don't want Maya's friends lists in my feed. "Stop showing me Maya's friends lists" takes me off that audience, and Maya isn't told.

**A stranger discovering (Cy)**
- On Discover, "Lists people love" shows public lists with real covers. I open one, see who made it and why each pick is there, and follow the curator in place with Undo.
- I never see Maya's Private or Friends lists, anywhere: not on her page, not in search, not in any API answer, not in my feed.

**A host who gets added to lists (Mo)**
- My page says "On 14 public lists" and shows the top 3, so new guests see that people they don't know picked me.
- My events show "5 would go again, including Ada" when guests who went say so.
- I can see I'm on public lists. I never learn I'm on someone's private or friends list, not even as a count.

## Visibility, per list

| Setting | Plain line under it | Who can open it | Where it shows |
| --- | --- | --- | --- |
| Private (default) | Only you | the owner | nowhere |
| Friends | Friends on Pottery Lab can look and add | people the owner added as friends | their feed, their "Shared with you", the link |
| Link | Anyone with the link can look | anyone holding the link | nowhere: unlisted |
| Public | On your page, Discover and the feed. People can follow it | anyone | the curator's page, Discover, followers' and friends' feeds, the host's "On N public lists" |

- Every new list starts Private. The old share links (/l/<token>) keep working: Link and Friends lists keep their token, and a Public list gets one too.
- Moving to Public asks once, with a preview of exactly what a stranger will see.
- Moving back to Private kills the link, takes the list off the curator page, Discover and feeds, and its followers stop seeing it. Follows are kept, so making it public again brings them back.
- Friends can add to a Friends list (planning together). A Public list is the curator's alone.

## The privacy model

- **One gate per surface, all server side.** Every public answer (curator page, Discover shelf, host lists, feed cards, comments and kudos on a list card, the vouch line) goes through one check: `canSee(viewer, owner, list)` in server/curation.js. Private never passes. Friends passes for the owner's friends only. Link passes only on the link route. Public passes for anyone.
- **Public items only.** A list shown to anyone other than its owner shows only what a public page already shows: public, listed events, real hosts and clubs, ideas. A private, unlisted, friends-only, members-only or example event is left out, and the count leaves it out too, so the title never shows.
- **Blocks hide lists both ways.** If either person blocked the other, the lists don't exist for them: no card, no page, no link, no vouch name.
- **Hosts see public lists only.** "On N public lists" counts Public lists alone. A host never learns about a Private, Friends or Link list.
- **Friends can step out.** A friend can take themselves off one person's Friends audience. The owner isn't told.
- **First names only**, as everywhere else. No email in any answer.
- **Not in search.** Lists are not indexed: list pages send noindex, and the curator page lists public lists only.

## Vouching: "I'd go again"

On a list item (an event or a host), anyone who went can tap **I'd go again**. The item, the event page and the host page show "5 would go again, including Maya", naming people the viewer knows first.

Why these words:
- It is how people talk after a good night, plain and warm. "Vouch" sounds like a reference check, and the host page already uses "vouch" for hosts recommending hosts, so a second meaning would confuse.
- It can only be true if you went. We allow it only after an attended RSVP (a past event you said I'm in to and didn't miss, or for a host, any of their past events you went to). That keeps the count honest and makes it worth reading.
- It matches what recaps already say ("90% would go again"), so guests and hosts read one idea in one voice.

The curator's own line on an item ("Order the dumplings") is a **note**, up to 120 characters, shown under the item wherever the list shows.

## Lists in the feed

Two card kinds, made by server/listfeed.js and drawn by public/listcards.js:
- **made**: "Maya made a list: Quiet dinners in Brooklyn (8)", the first 3 or 4 covers, then Follow list, Save, Kudos and Comment.
- **added**: "Maya added Dumpling Night and Sunday Pasta to Weekend ideas", with the covers of what was added.

Who sees them: the owner's friends for Friends lists; followers of the curator or the list, and friends, for Public lists. Never the owner's own feed, never across a block, never to a friend who stepped out.

Batching, so lists never flood the feed:
- At most one card per list per day, and only the newest one per list in the stream.
- **made** shows once a shared list has 3 or more public items.
- **added** shows only for a day with 2 or more new public items, after the list was already shown.
- Cards are kept for 14 days.

## Building a following

- **Curator page** at /@<handle>/lists: first name, public lists, follower count, Follow (one tap, in place, toast with Undo). The person's main page links to it when they have a public list.
- **Follow a curator or one list**: one tap, in place, toast with Undo, same as following a host.
- **Stats strip** in the library: followers, saves of your lists, and people who went to something from your lists (they opened, saved or followed the list, then said I'm in to an event on it).
- **The nudge**: when a Friends list has been opened by 5 or more friends, the list page asks once: "12 friends opened Quiet dinners. Make it public?" Not now hides it for that list.

## Hosts benefit

- A host's page shows "On 14 public lists" and the top 3 lists that include them or their events, each linking to the list.
- The count is public lists only, and only lists whose public view still shows the host.

## Metrics that would show it's working

- **Share rate**: share of lists that move off Private within 30 days (target: 20% of lists with 3+ items).
- **Public lists per weekly active guest**, and the share of curators with 1+ follower after 30 days.
- **Feed list-card tap-through** (open list or follow) versus event cards. Healthy if within 0.7x of event cards.
- **Went from a list**: RSVPs to events the person first saw on a list, per week. The north star for this feature.
- **I'd go again** taps per attended RSVP, and the share of event pages showing a line.
- **Host lift**: new followers for hosts in the week after they land on a public list.
- **Guardrails**: block and report rate on list cards, Friends-audience step-outs, unfollows within 7 days, and zero privacy leaks in the test suite.

## Out of scope (for now)

- Invites, waitlists or gating for curators. Anyone can make a list public.
- Ranking or leaderboards of curators, and a curator search.
- Push or email for new followers or list updates (the feed is the channel).
- Collaborative public lists, comments on single list items, reordering items.
- Copying someone's list into your own, and list templates.
- Paid or sponsored lists. Hosts can't buy their way onto a list.
