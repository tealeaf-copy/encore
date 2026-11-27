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
    `/plans/rtTable`, `/plans/rtTrip`, `/plans/rtSummit`, `/speakers/rtSummit/sp1`, `/e/rtTable`, "/start?t=table", "/guides/weekend-away", `/again/${S.past}?${q(S.pastRid)}`, `/k/${S.past}?${q(S.pastRid)}`, `/recap/${S.handle}`, `/p/${S.past}?${q(S.pastRid)}`, "/?app=1", "/leaderboard", "/pricing", "/me", `/year/${new Date().getFullYear()}`, /* Your places and the year in nights (server/places.js) */, `/post/e/${S.open}`, `/post/r/${S.past}` /* the feed's post pages (server/feedcomments.js) */,
    // friend invites (server/friendinvites.js): the admin page, and a link that no longer works
    { path: "/moderation", as: "admin" }, { path: "/admin/invites", as: "admin" }, "/join/FAAAAAAAAA",
    "/import/instagram", "/import/instagram?mode=refresh", { path: "/this-page-is-not-here", status: 404 }, { path: "/e/zz-not-here", status: 404 }, "/@tram",
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
