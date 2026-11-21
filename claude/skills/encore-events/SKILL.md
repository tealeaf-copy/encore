---
name: encore-events
description: Run B2B field events with Encore from Claude. Use when a marketer asks to plan, check on, launch, chase, follow up on or report on an event (exec dinners, conference booths, webinars, roadshows, customer advisory boards), or asks how their events program is doing.
---

# Running events with Encore

Encore is connected as the `encore` MCP server. It holds every event: details, guest list, plan, approvals, follow-ups and the 90-day pipeline report. Use its tools instead of guessing.

## Start every request the same way
1. Find the event: `list_events` (or `program_summary` for "how is the program doing").
2. Read it: `get_event` shows the facts, guest counts, the next tasks due, approvals and what's missing.
3. Then act with the tool that fits the request (below). Tell the user what you changed in one or two lines.

## What to use when
| The marketer says | Do this |
|---|---|
| "Set up a dinner for 20 CFOs in New York in March" | `create_event` with kind, objective, city, date, headcount, budget. Then say what's missing (from `get_event`). |
| "Change the date / seats / budget" | `update_event` with only the fields that change. |
| "Add these people" (a pasted list, a CSV, names from an email) | `add_guests`. Keep each person's owner (the AE or CSM who knows them). |
| "Who hasn't replied?" / "Who should I chase?" | `guest_list`, then group `waitingOnReplyByOwner` into one short note per owner. |
| "What follow-ups are outstanding?" | `followups_due`. Draft each follow-up from what the guest said, not a template. |
| "Give me the Luma / Partiful / Eventbrite / Sequel page" | `launch_kit`, then format the fields for that platform. |
| "Did the event work?" | `pipeline_report`. Report the three buckets and the caveat. Never call connected pipeline "created by the event". |
| "How's the program?" / "Where should the next dollar go?" | `program_summary`. Compare per-dollar figures only for finished events. |

## Rules
- Guests' emails, ARR, renewal dates, health and notes are internal. Use them to decide; never put them in anything a guest will read.
- Company-name-only deal matches are not confirmed. Don't add them to totals.
- One owner and one date per task. When you suggest work, say who does it and by when.
- If a field the user needs is missing (no date, no budget), ask for that one thing, then continue.
- Planning work that needs the studio (venues, artwork, proposals, seating) lives in the Encore app: say so and link to the event.

## Connecting Encore to Claude
On the Encore server, set `ENCORE_MCP_TOKEN` to a long random value. In Claude, add a custom connector with the URL `https://<your-encore-host>/mcp` and the header `Authorization: Bearer <that token>`. Anyone with the token can read and change events, so share it like a password.
