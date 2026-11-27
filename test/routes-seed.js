// Shared by test/routes-smoke.test.js and scripts/crawl-pages.mjs: seeds one small, realistic world (a host with a page,
// an experience and a drop; a signed-in guest; an admin; events coming up, today, asking and past with kudos, photos
// and a chat) and lists every user-facing page and the JSON APIs those pages call. No tests in here.
const J = { "content-type": "application/json" };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
// a 1x1 PNG, a real one (the photo routes sniff the bytes)
export const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

export async function seedRoutes(base) {
  const cookieOf = (r) => (r.headers.get("set-cookie") || "").split(";")[0];
  const post = async (p, body, cookie, h = {}) => fetch(base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}), ...h }, body: JSON.stringify(body) });
  const put = (p, body, cookie) => fetch(base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
  const patch = (p, body, cookie) => fetch(base + "/api/db/doc?path=" + p, { method: "PATCH", headers: { ...J, cookie }, body: JSON.stringify(body) });
  const signup = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const j = await r.json(); if (r.status !== 200) throw new Error("signup " + email + " " + JSON.stringify(j)); return { cookie: cookieOf(r), ws: j.workspace.id, email, name }; };
  const reply = async (eventId, key, { name, email, cookie }) => {
    const doc = await (await fetch(base + "/api/db/doc?path=events/" + eventId, { headers: { "x-encore-guest": "1" } })).json(), code = "C" + key.slice(-5).toUpperCase();
    const r = await fetch(base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": doc.workspace, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ eventId, response: doc.data.approvalRequired ? "requested" : "going", name, email, code, createdAt: Date.now(), via: "invite-lite" }) });
    const j = await r.json(); return { rid: String(j.id || "").split("/").pop(), code };
  };
  const host = await signup("Mai Pham", "mai.routes@example.com"), guest = await signup("Sam Ortiz", "sam.routes@example.com"), admin = await signup("Ada Admin", "admin@example.com");
  const up = await fetch(base + "/api/assets", { method: "POST", headers: { "content-type": "image/png", cookie: host.cookie }, body: PNG_1PX }), cover = (await up.json()).url;
  await post("/api/host/profile", { handle: "mai-routes", name: "Mai's Supper Club", city: "Brooklyn", hood: "Bed-Stuy", tagline: "Small dinners for new friends.", emoji: "🍜", theme: { avatarUrl: cover, coverUrl: cover },
    experiences: [{ id: "dumpling1", name: "Private dumpling night", desc: "A dumpling night for your team.", emoji: "🥟", min: 6, max: 14, price: "$65 a person", length: "2 hours", category: "food" }],
    shop: { open: true, title: "Chili crisp drop", where: "Bed-Stuy", items: [{ id: "crisp01", name: "Chili crisp", desc: "Small batch.", emoji: "🌶️", cents: 1200, stock: 10, max: 4 }] } }, host.cookie);
  const ev = (o) => ({ kind: "social", casual: true, activity: "dinner", city: "Brooklyn", meetPoint: "Bed-Stuy", startTime: "19:00", headcount: 8, emoji: "🥟", published: true, discoverable: true, unlisted: false, ...o });
  await put("events/rtOpen", ev({ name: "Dumpling night", date: day(6), coverPhoto: cover }), host.cookie);
  await put("events/rtAsk", ev({ name: "Supper by request", date: day(9), approvalRequired: true }), host.cookie);
  await put("events/rtDraft", ev({ name: "Draft supper", date: day(20), published: false, discoverable: false }), host.cookie);
  await put("events/rtToday", ev({ name: "Tonight's supper", date: day(0) }), host.cookie);
  await put("events/rtPast", ev({ name: "Last week's supper", date: day(2) }), host.cookie);
  const g = await reply("rtOpen", "kroutesopen1", { name: guest.name, email: guest.email, cookie: guest.cookie });
  const p = await reply("rtPast", "kroutespast1", { name: guest.name, email: guest.email, cookie: guest.cookie });
  await reply("rtAsk", "kroutesask01", { name: "Jo Kim", email: "jo.routes@example.com" });
  await patch("events/rtPast", { date: day(-5) }, host.cookie);
  await post("/api/public/kudos", { eventId: "rtPast", rid: p.rid, code: p.code, tags: ["again", "welcome"], love: "Like dinner with old friends." });
  await fetch(`${base}/api/moments?eventId=rtPast`, { method: "POST", headers: { "content-type": "image/png", cookie: host.cookie }, body: PNG_1PX });
  await post("/api/chats/rtOpen/messages", { text: "So glad you're coming." }, host.cookie);
  await post("/api/chats/rtOpen/messages", { rid: g.rid, code: g.code, text: "Can't wait." }, guest.cookie);
  await post("/api/public/follow", { handle: "mai-routes", email: guest.email, name: guest.name }, guest.cookie);
  // review 18: one of each scale (server/kinds.js): a booked table, a weekend away, a summit with a public speaker
  await put("events/rtTable", ev({ name: "Dinner at Lilia", date: day(7), startTime: "19:30", planKind: "table", noMaybe: true, discoverable: false, unlisted: true, headcount: 5, venueName: "Lilia", meetPoint: "",
    reservation: { restaurant: "Lilia", time: "19:30", party: 6, link: "https://resy.com/lilia", confirmation: "R-1", holdUntil: day(5), split: "even" } }), host.cookie);
  await put("events/rtTrip", ev({ name: "Cabin weekend", date: day(10), endDate: day(12), startTime: "16:00", planKind: "weekend", noMaybe: true, carpool: true, discoverable: false, unlisted: true,
    lodging: { name: "Creek House", area: "Phoenicia", checkIn: "16:00", checkOut: "11:00", address: "41 Creek Rd" }, beds: [{ id: "b1", room: "Loft", label: "Queen", sleeps: 2 }] }), host.cookie);
  await put("events/rtSummit", ev({ name: "Small summit", date: day(14), endDate: day(15), startTime: "09:30", planKind: "summit", kind: "summit", noMaybe: true, itineraryPublic: true, headcount: 80,
    speakers: [{ id: "sp1", name: "Ana Ruiz", title: "Head of Design", public: true }], sponsors: [{ name: "Fernwood Labs" }],
    agenda: { tracks: ["Design"], rooms: [{ name: "Main hall", capacity: 80 }], sessions: [{ id: "s1", day: 1, time: "10:00", title: "Keynote", track: "Design", room: "Main hall", speakers: ["sp1"] }] } }), host.cookie);
  const trip = await reply("rtTrip", "kroutestrip1", { name: guest.name, email: guest.email, cookie: guest.cookie });
  await reply("rtSummit", "kroutessumm1", { name: guest.name, email: guest.email, cookie: guest.cookie });
  // ---- lists people follow (server/curation.js): Sam's public list, a note, I'd go again, Mai follows Sam ----
  await fetch(base + "/api/me/profile", { headers: { cookie: guest.cookie } });
  const lst = await (await post("/api/me/library/lists", { name: "Quiet dinners in Brooklyn", note: "Small tables, good talk." }, guest.cookie)).json();
  for (const [kind, ref, title] of [["event", "rtToday", "Tonight's supper"], ["event", "rtAsk", "Supper by request"], ["event", "rtTable", "Dinner at Lilia"], ["host", "mai-routes", "Mai's Supper Club"], ["event", "rtOpen", "Dumpling night"]]) await post(`/api/me/library/lists/${lst.list.id}/items`, { kind, ref, title }, guest.cookie);
  await post(`/api/me/library/lists/${lst.list.id}/note`, { kind: "event", ref: "rtOpen", why: "Order the dumplings, sit at the bar." }, guest.cookie);
  const pub = await (await post(`/api/me/library/lists/${lst.list.id}`, { share: "public" }, guest.cookie)).json();
  await post("/api/me/again", { kind: "event", ref: "rtPast", on: true }, guest.cookie); await post("/api/me/again", { kind: "host", ref: "mai-routes", on: true }, guest.cookie);
  const guestHandle = (await (await fetch(base + "/api/me/profile", { headers: { cookie: guest.cookie } })).json()).person?.handle || "";
  await post(`/api/me/curators/${guestHandle}/follow`, { on: true }, host.cookie);
  const listToken = String(pub.list?.link || "").slice(3);
  // ---- end lists ----
  return { listHandle: guestHandle, listToken, host, guest, admin, cover, handle: "mai-routes", exp: "dumpling1", open: "rtOpen", past: "rtPast", ask: "rtAsk", today: "rtToday", draft: "rtDraft", openRid: g, pastRid: p, tripRid: trip };
}

// every user-facing page. `as` limits a page to a role ("admin" pages 404 for everyone else, on purpose).
export function pagesFor(S) {
  const q = (r) => `rid=${encodeURIComponent(r.rid)}&code=${encodeURIComponent(r.code)}`;
  return [
    "/", "/feed", "/discover", "/events", "/ideas", "/hosts", "/saved", "/plans", "/chats", `/chats/${S.open}`, "/settings", "/community", "/playbook",
    "/signup", "/login", "/about", "/privacy", "/terms", `/@${S.handle}`, `/e/${S.open}`, `/e/${S.past}`, `/i/${S.open}`, "/g", `/x/${S.handle}/${S.exp}`,
    `/plans/rtTable`, `/plans/rtTrip`, `/plans/rtSummit`, `/speakers/rtSummit/sp1`, `/e/rtTable`, "/start?t=table", "/guides/weekend-away", `/again/${S.past}?${q(S.pastRid)}`, `/k/${S.past}?${q(S.pastRid)}`, `/recap/${S.handle}`, `/p/${S.past}?${q(S.pastRid)}`, "/?app=1", "/leaderboard", "/pricing", "/me", `/year/${new Date().getFullYear()}`, /* Your places and the year in nights (server/places.js) */ `/post/e/${S.open}`, `/post/r/${S.past}` /* the feed's post pages (server/feedcomments.js) */,
    // friend invites (server/friendinvites.js): the admin page, and a link that no longer works
    { path: "/moderation", as: "admin" }, { path: "/admin/invites", as: "admin" }, "/join/FAAAAAAAAA",
    "/import/instagram", "/import/instagram?mode=refresh", { path: "/this-page-is-not-here", status: 404 }, { path: "/e/zz-not-here", status: 404 }, "/@tram",
    "/proposals", "/proposals/new", "/proposals/example/dinner", // brand proposals (server/proposals.js): the host's list and builder, and an example
    "/teamup", "/teamup/0000000000000000", "/hosts?view=teamup", // Team up (server/collab.js): your threads, a thread that isn't yours, the Team up view
    "/teams/market", "/host/insights", { path: "/admin/paid-insights", as: "admin" }, // paid insights (server/paidinsights.js)
    ...(S.listHandle ? [`/@${S.listHandle}/lists`, "/library"] : []), ...(S.listToken ? [`/l/${S.listToken}`] : []), // lists people follow (server/curation.js)
  ].map((x) => (typeof x === "string" ? { path: x } : x));
}

// the JSON APIs those pages call on load (found by scripts/crawl-pages.mjs). Signed-in-only ones say so.
export function apisFor(S) {
  const q = (r) => `rid=${encodeURIComponent(r.rid)}&code=${encodeURIComponent(r.code)}`;
  return [
    "/api/signup/config", "/api/public/feed", "/api/public/discover", "/api/public/inspo", "/api/public/hosts", `/api/public/host/${S.handle}`, `/api/public/host/${S.handle}/scrapbook`,
    `/api/public/kudos-page/${S.past}?${q(S.pastRid)}`, "/api/v1/events", "/api/v1/hosts", "/api/public/leaderboard", "/api/igimport/config",
    { path: "/api/me", signedIn: true }, { path: "/api/me/feed", signedIn: true }, { path: "/api/me/saves", signedIn: true }, { path: "/api/chats", signedIn: true },
    { path: `/api/chats/${S.open}`, signedIn: true }, { path: "/api/me/inbox", signedIn: true }, { path: "/api/photos/recent", signedIn: true }, { path: "/api/photos/templates?kind=cover" }, { path: "/api/photos/templates?kind=avatar" },
    { path: "/api/host/profile", host: true }, { path: "/api/db/collection?path=events", host: true }, { path: `/api/host/kudos/${S.past}`, host: true },
    { path: "/api/admin/reports", as: "admin" },
  ].map((x) => (typeof x === "string" ? { path: x } : x));
}

// The event-page audit's world (scripts/event-audit.mjs): seedRoutes, plus one event per state a guest can meet, and
// the reply proof each guest's browser holds. Guests who replied signed out are replayed with that proof in
// localStorage, the way a phone comes back to the link.
export async function seedAudit(base) {
  const S = await seedRoutes(base);
  const cookieOf = (r) => (r.headers.get("set-cookie") || "").split(";")[0];
  const post = async (p, body, cookie) => fetch(base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const put = (p, body, cookie) => fetch(base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
  const patch = (p, body, cookie) => fetch(base + "/api/db/doc?path=" + p, { method: "PATCH", headers: { ...J, cookie }, body: JSON.stringify(body) });
  const signup = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const j = await r.json(); if (r.status !== 200) throw new Error("signup " + email + " " + JSON.stringify(j)); return { cookie: cookieOf(r), ws: j.workspace.id, email, name }; };
  let n = 0;
  const reply = async (eventId, { name, email, cookie, response = "going" } = {}) => { const key = "kaudit" + String(++n).padStart(6, "0"), code = "A" + String(n).padStart(5, "0");
    const doc = await (await fetch(base + "/api/db/doc?path=events/" + eventId, { headers: { "x-encore-guest": "1", ...(cookie ? { cookie } : {}) } })).json();
    const r = await fetch(base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": doc.workspace, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ eventId, response: doc.data?.approvalRequired ? "requested" : response, name, email, code, createdAt: Date.now(), via: "invite-lite" }) });
    const j = await r.json(); if (!r.ok) throw new Error("reply " + eventId + " " + JSON.stringify(j)); return { rid: String(j.id || "").split("/").pop(), code, name }; };
  const H = S.host.cookie, ev = (o) => ({ kind: "social", casual: true, activity: "dinner", city: "Brooklyn", hood: "Bed-Stuy", meetPoint: "Bed-Stuy", startTime: "19:00", headcount: 8, emoji: "🥟", published: true, discoverable: true, unlisted: false, date: day(8), ...o });
  const nia = await signup("Nia Brooks", "nia.audit@example.com"); // signed in, never replied to anything
  const bo = await signup("Bo Tran", "bo.audit@example.com"); // a second host: co-host on one of Mai's, and a fan club with a members-first window
  await post("/api/host/profile", { handle: "bo-audit", name: "Bo's Table", city: "Brooklyn", tagline: "Noodles on Sundays." }, bo.cookie);
  const SECRET = "41 Hidden Lane, Apt 3";
  await post("/api/host/profile", { handle: "mai-routes", name: "Mai's Supper Club", venmo: "mai-routes" }, H);
  await put("events/auPlace", ev({ name: "Pasta at the library", venueName: "Sunset Park Library", venueAddr: "5108 4th Ave", meetPoint: "Sunset Park Library", coverPhoto: S.cover, description: "Fresh pasta and a long table.", bring: ["A jar for leftovers"] }), H);
  await put("events/auHome", ev({ name: "Supper at my place", meetPoint: "Mai's place", venueAddr: SECRET, addrHidden: true, description: "Dinner in my kitchen." }), H);
  await put("events/auLong", ev({ name: "A very long evening of hand-pulled noodles, slow broth and stories from three grandmothers' kitchens", meetPoint: "", hood: "", city: "", description: "We start with tea. ".repeat(60).trim() }), H);
  await put("events/auFull", ev({ name: "Tiny tasting", headcount: 2 }), H);
  await put("events/auAsk", ev({ name: "Chef's counter", approvalRequired: true }), H);
  await put("events/auPaid", ev({ name: "Ramen class", price: "$25" }), H);
  await put("events/auCancel", ev({ name: "Cancelled picnic" }), H);
  await put("events/auMoved", ev({ name: "Moved brunch", date: day(11), look: { update: { text: "New date: one week later.", at: Date.now() } } }), H);
  await put("events/auPrivate", ev({ name: "Birthday dinner", discoverable: false, unlisted: true }), H);
  await put("events/auCohost", ev({ name: "Two-host supper", cohosts: [{ handle: "bo-audit", name: "Bo" }] }), H);
  await put("events/auExample", ev({ name: "Example supper", example: true }), H);
  const st = {};
  for (const r of ["going", "maybe", "no"]) st["place-" + r] = { id: "auPlace", ...(await reply("auPlace", { name: "Lee " + r, email: `lee.${r}@example.com`, response: r })), response: r };
  st["home-going"] = { id: "auHome", ...(await reply("auHome", { name: "Ana Diaz", email: "ana.audit@example.com" })), response: "going" };
  await reply("auFull", { name: "Kim A", email: "kima@example.com" }); await reply("auFull", { name: "Kim B", email: "kimb@example.com" });
  st["full-wait"] = { id: "auFull", ...(await reply("auFull", { name: "Wes Wait", email: "wes@example.com" })), response: "waitlist" };
  for (const k of ["pending", "approved", "declined"]) st["ask-" + k] = { id: "auAsk", ...(await reply("auAsk", { name: "Ari " + k, email: `ari.${k}@example.com` })), response: "requested" }; // the phone keeps "requested"; the host says yes or no later
  await patch("rsvps/" + st["ask-approved"].rid, { response: "going" }, H); await patch("rsvps/" + st["ask-declined"].rid, { response: "declined" }, H);
  st["paid-unpaid"] = { id: "auPaid", ...(await reply("auPaid", { name: "Pat Unpaid", email: "pat.u@example.com" })), response: "going" };
  st["paid-paid"] = { id: "auPaid", ...(await reply("auPaid", { name: "Pat Paid", email: "pat.p@example.com" })), response: "going" };
  await patch("rsvps/" + st["paid-paid"].rid, { paid: true, paidAt: Date.now() }, H);
  st["cancel-going"] = { id: "auCancel", ...(await reply("auCancel", { name: "Cy Gone", email: "cy@example.com" })), response: "going" };
  st["moved-going"] = { id: "auMoved", ...(await reply("auMoved", { name: "Mo Moved", email: "mo@example.com" })), response: "going" };
  await patch("events/auCancel", { cancelled: true }, H);
  // the fan club: members first for 48 hours (Sam, the seeded guest, is a member; Nia is not)
  await post("/api/host/club", { on: true, earlyHours: 48 }, bo.cookie); await post("/api/me/club/bo-audit/join", {}, S.guest.cookie);
  await put("events/auEarly", ev({ name: "Members-first noodles", meetPoint: "Bo's place", venueAddr: SECRET, addrHidden: true }), bo.cookie);
  // a drop (an order page)
  const d = await (await post("/api/host/drops", { title: "Chili crisp Saturday", items: [{ name: "Chili crisp", price: "12" }], slots: ["Sat 10 to 11am"], area: "Bed-Stuy", address: SECRET, always: true, pay: "pickup" }, H)).json();
  // a brand-bookable experience (/teams/x/<handle>/<pkg>)
  await post("/api/host/profile", { handle: "mai-routes", name: "Mai's Supper Club", forHire: true }, H);
  const B = await (await post("/api/bb/host/setup", { on: true, policy: "standard", area: "Bed-Stuy", city: "Brooklyn", address: SECRET, phone: "+1 718 555 0100", story: "I cook for people I like.", since: 2019,
    packages: [{ name: "Supper club for your team", story: "Six courses at a long table.", moods: ["client", "bonding"], perPersonCents: 12000, minimumCents: 120000, minGuests: 6, maxGuests: 14, leadDays: 7, includes: ["Ingredients", "Venue", "Service"], weekdays: [1, 2, 3, 4, 5], time: "evening", taxBps: 0, depositPct: 25 }] }, H)).json().catch(() => ({}));
  return { ...S, nia, bo, secret: SECRET, drop: d.id || "", pkg: B?.setup?.packages?.[0]?.id || "", states: st };
}

// The whole cast for scripts/click-audit.mjs: everything seedRoutes() makes, plus a new guest with no replies, guests
// who said maybe and who are on a waitlist, a fan club with a member, a drop seller with a live drop and a pre-order,
// a summit host and a trip host of their own, and (with a store) the Fernwood Labs brand world: a team with campaigns,
// bookings, briefs and a report (test/brand-panel-seed.js). Audits and screenshots only, always in a temp store.
export async function seedClickAudit(base, store, { brand = true } = {}) {
  const S = await seedRoutes(base);
  const cookieOf = (r) => (r.headers.get("set-cookie") || "").split(";")[0];
  const post = async (p, body, cookie, h = {}) => { const r = await fetch(base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}), ...h }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${p} ${r.status} ${(await r.text()).slice(0, 200)}`); return r; };
  const put = async (p, body, cookie) => { const r = await fetch(base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`put ${p} ${r.status}`); };
  const signup = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const j = await r.json(); return { cookie: cookieOf(r), ws: j.workspace.id, email, name }; };
  const answer = async (eventId, key, response, who) => { const doc = await (await fetch(base + "/api/db/doc?path=events/" + eventId, { headers: { "x-encore-guest": "1" } })).json(), code = "C" + key.slice(-5).toUpperCase();
    const r = await fetch(base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": doc.workspace, ...(who.cookie ? { cookie: who.cookie } : {}) }, body: JSON.stringify({ eventId, response, name: who.name, email: who.email, code, createdAt: Date.now(), via: "invite-lite", ...(who.extra || {}) }) });
    const j = await r.json(); return { rid: String(j.id || "").split("/").pop(), code, response: j.response || response }; };
  const ev = (o) => ({ kind: "social", casual: true, activity: "dinner", city: "Brooklyn", meetPoint: "Bed-Stuy", startTime: "19:00", headcount: 8, emoji: "🥟", published: true, discoverable: true, unlisted: false, ...o });
  const newGuest = await signup("Nia New", "nia.audit@example.com");
  const maybe = await signup("Lee Maybe", "lee.audit@example.com"), wait = await signup("Wren Wait", "wren.audit@example.com");
  // a small table that fills, so the next yes waits
  await put("events/rtSmall", ev({ name: "Six seat supper", date: day(8), headcount: 2 }), S.host.cookie);
  await answer("rtSmall", "kauditsmall1", "going", { name: "Fay Full", email: "fay.audit@example.com" });
  await answer("rtSmall", "kauditsmall2", "going", { name: "Gil Full", email: "gil.audit@example.com" });
  const maybeRid = await answer(S.open, "kauditmaybe1", "maybe", maybe), waitRid = await answer("rtSmall", "kauditwait01", "going", wait);
  // the host's fan club, with the guest in it
  await post("/api/host/club", { on: true, name: "Supper regulars", pitch: "First pick of seats.", perks: ["Seats a day early"], earlyHours: 24 }, S.host.cookie);
  await post(`/api/me/club/${S.handle}/join`, {}, S.guest.cookie);
  // a drop seller with a live drop and one pre-order
  const seller = await signup("Bo Tran", "bo.audit@example.com");
  await post("/api/host/profile", { handle: "bo-bakes", name: "Bo Bakes", city: "Brooklyn", hood: "Sunset Park", tagline: "Pandan cakes on Saturdays.", emoji: "🍰" }, seller.cookie);
  const drop = await (await post("/api/host/drops", { title: "Pandan this Saturday", items: [{ name: "Pandan honeycomb cake", price: "18", stock: 12 }, { name: "Kaya toast box", price: "9.50", stock: 6 }], slots: ["Sat 9 to 10am"], area: "Sunset Park", address: "5 Audit St, Apt 2", always: true, pay: "pickup" }, seller.cookie)).json();
  const order = await answer(drop.id, "kauditorder1", "going", { ...S.guest, extra: { orderQty: [{ i: 0, qty: 1 }] } });
  // a summit host and a trip host of their own
  const summitHost = await signup("Ana Summit", "ana.audit@example.com"), tripHost = await signup("Tom Trip", "tom.audit@example.com");
  await post("/api/host/profile", { handle: "ana-summit", name: "Small Summits", city: "Brooklyn", hood: "Dumbo", tagline: "One day, eighty people." }, summitHost.cookie);
  await post("/api/host/profile", { handle: "tom-trips", name: "Tom's Weekends", city: "Brooklyn", hood: "Park Slope", tagline: "Cabins with friends." }, tripHost.cookie);
  await put("events/auSummit", ev({ name: "Design summit", date: day(16), endDate: day(17), startTime: "09:30", planKind: "summit", kind: "summit", noMaybe: true, itineraryPublic: true, headcount: 80,
    speakers: [{ id: "sp1", name: "Ana Ruiz", title: "Head of Design", public: true }], agenda: { tracks: ["Design"], rooms: [{ name: "Main hall", capacity: 80 }], sessions: [{ id: "s1", day: 1, time: "10:00", title: "Keynote", track: "Design", room: "Main hall", speakers: ["sp1"] }] } }), summitHost.cookie);
  await put("events/auTrip", ev({ name: "Lake weekend", date: day(12), endDate: day(14), startTime: "16:00", planKind: "weekend", noMaybe: true, carpool: true, discoverable: false, unlisted: true,
    lodging: { name: "Lake House", area: "Woodstock", checkIn: "16:00", checkOut: "11:00", address: "9 Lake Rd" }, beds: [{ id: "b1", room: "Loft", label: "Queen", sleeps: 2 }] }), tripHost.cookie);
  await answer("auSummit", "kauditsumm01", "going", S.guest); await answer("auTrip", "kaudittrip01", "going", S.guest);
  // a group trip still at the feeler stage (server/trips.js): friends answer which weekend and what they'd spend
  const yr = new Date().getFullYear() + 1, vegas = (await (await post("/api/host/trips", { say: "Vegas for a 30th, sometime in March" }, tripHost.cookie)).json()).id;
  await post(`/api/host/trips/${vegas}/feeler`, { destination: "Las Vegas", weekends: [{ from: `${yr}-03-12`, to: `${yr}-03-14` }, { from: `${yr}-03-26`, to: `${yr}-03-28` }], note: "Two nights, flights on your own.", publish: true }, tripHost.cookie);
  let B = null;
  if (brand && store) { const { seedBrandPanel } = await import("./brand-panel-seed.js"); B = await seedBrandPanel(base, store, { guests: 60 }); }
  return { ...S, newGuest, maybe: { ...maybe, rid: maybeRid }, wait: { ...wait, rid: waitRid }, small: "rtSmall", seller, drop: drop.id, order, summitHost, tripHost, summit: "auSummit", trip: "auTrip", vegas, brand: B };
}
