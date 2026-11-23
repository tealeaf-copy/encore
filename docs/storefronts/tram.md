# Tram's storefront

Her page lives at `/@tram` once her account is set up. The full profile is in `tram.json` next to this file.

## What's on it

- **Name and line:** Tram. "Matcha, home-cooked Vietnamese, and bánh patê sô warm from the oven."
- **Look:** matcha green, sage background, a wave cover, and the barista sketch as her avatar (swap in a real photo any time).
- **Bio:** "I whisk matcha the slow way and cook the Vietnamese dishes I grew up on. Come for a bowl of bún, stay for a second bánh patê sô. Small tables, big flavours, everyone leaves full."
- **Tags:** matcha, vietnamese, home cooking, pastries, workshops.
- **This week's bake (shop, pickup only):**
  - Bánh patê sô, box of 4: $20 (12 boxes)
  - Matcha kit for two: $35 (6 kits)
- **For teams and brands:**
  - Matcha workshop for your team: 8–30 people, 75 minutes, comes to you, from $45 a person.
  - Vietnamese home-cooking table: 8–25 people, 2 hours, from $55 a person.
  - Invoices, replies within a day, free to cancel up to 7 days before, 50% deposit holds the date.

**Prices, quantities and the city (Brooklyn) are placeholders.** Change them to Tram's real ones before she shares the page.

## Put it on the live site

1. Tram signs up at https://encore-2qzx.onrender.com/signup with an invite code (OINKOINK works), choosing "With friends".
2. Signed in, she opens the browser console on any Encore page and pastes:

```js
fetch("/api/host/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(PROFILE) }).then((r) => r.json()).then(console.log)
```

with `PROFILE` replaced by the contents of `tram.json`. Or she fills in the same fields under My page → Customize.

3. She adds a few photos of her matcha and pastries on My page. Photos make the biggest difference to how the page looks.
4. Her first get-together, e.g. "Matcha morning at my place Saturday at 10", takes one sentence on Home.
