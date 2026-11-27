# CRM sync (beta)

Campaigns can send guests to HubSpot or Salesforce, next to the CSV export. Code: `server/crmsync.js` (the adapters),
routes in `server/brandpanel.js`, UI on a campaign's Measure tab. Tests: `test/brand-panel.test.js` (fakes only).

It is marked beta because it has not been run against live HubSpot or Salesforce accounts yet.

## Rules

- Consent only: a guest is sent only if they said yes to sharing their details with the brand.
- Never feedback: survey answers, quotes, "would go again" and connections never leave Pottery Lab.
- Preview first: "Preview (dry run)" shows the counts, who is left out and why, and the first request body. Nothing is sent.

## Setup (server env vars, never in the repo)

| CRM | Env vars |
| --- | --- |
| HubSpot | `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, `HUBSPOT_REDIRECT_URI` (`https://<host>/api/crm/hubspot/callback`) |
| Salesforce | `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_REDIRECT_URI` (`https://<host>/api/crm/salesforce/callback`), optional `SF_LOGIN_URL` |

A brand connects with `/api/crm/<provider>/connect`, which runs OAuth and stores the token in the brand's workspace
(`ws/<brand>/crm/<provider>`). `ENCORE_FAKE_CRM=1` fakes the OAuth and the API (development and screenshots).

## What is sent

- HubSpot: `POST /crm/v3/objects/contacts/batch/upsert` by email, 100 per batch. Custom properties (`pottery_lab_*`) must exist in the portal, or be left unmapped.
- Salesforce: `PATCH /services/data/v60.0/composite/sobjects/Lead/Email` (upsert by Email; needs Email as an external ID), 200 per batch, `LeadSource` "Pottery Lab". Custom fields end in `__c`.

The field mapping is saved per campaign. Any field can be set to "Don't send" except the ones the CRM requires (email; for Salesforce also last name and company).
