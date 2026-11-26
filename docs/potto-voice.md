# Potto's voice

Potto is the small clay pot who keeps the guest list. He sounds like a friend who keeps a notebook for you: dry, warm, a little self-aware, and quietly on your side. He shows up at the moments that matter (a celebration, a streak heads-up, an empty Home, a reminder before or after an event) and otherwise stays out of the way.

Our hosts are introverted and have high standards. They're engineers, gamers, operators and people who like exploring their city. They will notice if Potto tries too hard.

## The short version

- **Dry, then warm.** Lead with the plain fact, then add one kind line. "Pie night is tomorrow. Three things, and then you're done."
- **Small asks.** Always offer the smallest version that still counts. "Even a coffee counts."
- **Showing up is the win.** Praise the effort, not the numbers. Ten guests or two, it happened.
- **He knows he's a pot.** A little self-aware humour is fine, once a screen at most. "I'll keep the list. It's the one thing I'm good at."
- **Never guilt.** A quiet month is normal life. A lapsed streak gets a kind line and an easy restart, never a sad face.
- **Plain and short.** One or two sentences. No em dashes. No exclamation marks unless something really happened. No emoji in sentences.

## Do

- "The table misses you. Even a coffee counts."
- "It's been 5 weeks since Dumpling Night. Same crew, new month?"
- "Your first one is out in the world. Now the only job is to show up. I'll keep the list."
- "A rest pass covered last month. Your 3-month streak is safe."
- "Your 4-week streak is paused, not gone. Host anything by Sun, Dec 6, even a coffee, and it's back."
- "Your 6-month streak ended. Streaks end; tables don't. The next one starts a new run."
- "Done. That counts."
- "Nothing on the calendar. That's fine. A dinner for four is a whole event."
- "How was Soup night? A two-line thank-you to the 4 guests who came is the thing they'll remember."
- "Someone came back a third time. That's the whole point."

## Don't

| Don't | Why | Instead |
| --- | --- | --- |
| "Don't break your streak!!" | Panic and guilt | "If it stays quiet, a rest pass covers it." |
| "You lost your 6-month streak." | Shame, a sense of failure | "Your 6-month streak ended. The next one starts a new run." |
| "Potto is sad you haven't hosted." | Passive-aggressive | "The table misses you. Even a coffee counts." |
| "Crush your hosting goals this month!" | Hype, not us | "12 of 30 warmth in November." |
| "You're #8 of 10. Others are beating you." | Ranking people by popularity | "Staying at the kitchen table. The top three move up." |
| "AMAZING! You're a superstar host!" | Childish, too loud | "Ten nights hosted. That's a habit now. A good one." |
| "Unlock exclusive rewards by hosting more." | Slot-machine framing | "Your first event earns your first rest pass." |
| "Hey there! Just checking in!" | Filler | Say the one useful thing, or say nothing. |

## Where he appears

| Moment | Pose | Example |
| --- | --- | --- |
| A real milestone (first event out, 10th, first sold-out, first regular) | cheer | "Every seat taken." |
| Streak heads-up, before a period ends | think | "November ends in 4 days. If it stays quiet, a rest pass covers it." |
| Repair window | think | "The table misses you. Even a coffee counts." |
| Empty Home or a first visit | wave | "A dinner for four is a whole event." |
| The save prompt on /start | carry | "Save your dinner and get a link to send." |
| Notifications (push, bell, email) | none (the title is "Potto") | "Pie night is tomorrow. Three things: send a reminder, check the spots, pick a playlist." |

One Potto per screen. If the page already has him, the line goes without the drawing.

## Notifications

- Timed to the host's own rhythm: the weekday and hour they usually make events (Sunday 6pm until we've seen three).
- Never in quiet hours (9pm to 9am by default), at most 2 in any 7 days, and each kind can be turned off in Settings.
- The four kinds: before an event (a short checklist), after an event (thank your guests), streak heads-ups, and a nudge when it's been a while.
- Every note says one thing and links to the one place to do it.

## Where the words live

- Streak lines, heads-ups, small moves, milestones and nudges: `server/hostloop.js` (`streakLine`, `headsUp`, `MOVES`, `MILESTONES`, `planNudges`, `POTTO`).
- The help assistant's prompt points here for tone (`server/help.js`).
- Tests check the copy has no em dashes and no guilt words (`test/hostloop.test.js`).
