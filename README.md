# Encore

A prototype event studio for B2B field marketers. A crew of AI agents takes an event from idea to launch: brand onboarding, buyer personas, idea deck, validation, venues, copy, promotion, production, guests, and impact.

## What's here

- `index.html`: the whole app, a single page published as a Claude artifact.
- `venues/venues.json`: research notes on the three Chicago venues used in the example event, with sources.

Venue photos are not stored in this repo. They're hosted with the published artifact and belong to the venues.

## How it runs

The page runs inside claude.ai as an artifact. It uses the viewer's Claude account for the AI agents, a shared database for events and feedback, and the viewer's own connectors (Gmail, Google Drive, Notion, and optionally Gong, HubSpot, Salesforce, web search) for research. Opened as a plain file in a browser, it shows example data and the AI features stay off.
