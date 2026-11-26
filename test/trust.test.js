import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { shareLine, trustFrom, isPlaceholderName, isPlaceholderBrand, MIN_N } from "../server/recognition.js";
import { goalFit, placeFit } from "../server/search.js";
import { sameHost, cleanProof } from "../server/hosts.js";
import { startServer } from "./helpers.js";

test("One way to say a share: a percentage with its n at 10+, counts below", () => {
  assert.equal(MIN_N, 10);
  assert.equal(shareLine(16, 18, "guests", "came back").text, "89% of 18 guests came back");
  const small = shareLine(5, 6, "guests", "came back"); assert.equal(small.text, "5 of 6 guests came back"); assert.equal(small.pct, null);
  assert.equal(shareLine(0, 6, "guests", "came back"), null);
});

test("Trust shows only real or labelled proof: no placeholder people or brands, host-entered things say so", () => {
  assert.ok(isPlaceholderName("Sample Person")); assert.ok(isPlaceholderName("Jane Doe")); assert.ok(!isPlaceholderName("Maya R."));
  assert.ok(isPlaceholderBrand("Northwind Studio")); assert.ok(isPlaceholderBrand("Acme Health")); assert.ok(!isPlaceholderBrand("Brightline Labs"));
  const h = { name: "Tram's Matcha Table", gigs: [{ client: "Northwind Studio" }, { client: "Brightline Labs", what: "offsite" }], corpQuotes: [{ quote: "Easiest offsite block I've planned.", name: "Sample Person", company: "Northwind Studio" }, { quote: "Everyone asked for the recipe.", name: "Dana Lee", company: "Brightline Labs" }] };
  const T = trustFrom({ S: { guests: 18, returning: 16, againYes: 9, againOf: 12, kudosCount: 12, dates: ["2026-01-01"] }, h, bookings: [{ company: "Helix AI", status: "done", date: "2026-01-01", listOk: true }, { company: "Pending Co", status: "new" }, { company: "Upcoming Co", status: "booked", date: "2099-01-01", listOk: true }, { company: "Quiet Co", status: "done", date: "2026-01-01" }] });
  // only finished bookings whose brand said it's OK to be named; an upcoming booking or a silent brand stays private
  assert.deepEqual(T.workedWith.map((w) => [w.client, w.label]), [["Helix AI", "Booked on Pottery Lab"], ["Brightline Labs", "Added by the host"]]);
  assert.deepEqual(T.testimonials.map((q) => [q.name, q.label]), [["Dana Lee", "Added by the host"]]);
  assert.equal(T.returned.text, "89% of 18 guests came back for another"); assert.equal(T.again.text, "75% of 12 guests who left kudos would go again");
  assert.equal(T.insurance.text, "Insurance: ask the host"); assert.equal(T.insurance.onFile, false);
  // "on request" only for a host who said they're insured
  assert.equal(trustFrom({ h: { ...h, insured: true } }).insurance.text, "Says they're insured. Certificate on request");
  const I = trustFrom({ h: { name: "X", insuranceDoc: "/_blob/abcdefghijklmnopqrst" }, proof: { coi: { expires: "2099-03-01" } } });
  assert.match(I.insurance.text, /^Insurance certificate on file \(expires Mar 1, 2099\)$/); assert.ok(I.insurance.url);
  const E = trustFrom({ h, example: true, badges: [{ id: "legend" }] });
  assert.ok(E.workedWith.every((w) => w.label === "Example")); assert.deepEqual(E.badges, []); assert.equal(E.insurance.onFile, false);
  const N = trustFrom({ h: { name: "Pottery Lab Studio" } }); assert.ok(N.isNewHere); assert.match(N.newLine, /^Sending a request is free/); assert.deepEqual(N.lines, []);
});

test("The goal decides the match: an omakase counter beats a run for an exec dinner; a venue wins a meetup", () => {
  const omakase = { name: "Omakase roundtable for 12", desc: "Ten courses at one counter", category: "dining", min: 8, max: 12, seated: 12 };
  const run = { name: "Team fun run + coffee", desc: "A 5k loop and coffee after", category: "movement", min: 8, max: 40 };
  const venue = { name: "Meetup evening", desc: "Talks and drinks; we handle setup and AV", category: "drinks", min: 30, max: 80, standing: 80, av: "Projector" };
  const ex = goalFit("exec", omakase, 14); assert.ok(ex && ex.score > 0); assert.ok(ex.why.some((w) => /ask about 14/.test(w)));
  const r = goalFit("exec", run, 14); assert.ok(!r || r.score < ex.score - 5);
  assert.ok(goalFit("community", venue, 40).score > (goalFit("community", run, 40)?.score ?? -99));
  assert.equal(goalFit("exec", omakase, 40), null, "far too many people");
  assert.equal(placeFit("Manhattan", { city: "Manhattan" }), "here"); assert.equal(placeFit("Manhattan", { city: "New York", hood: "Bushwick" }), "metro"); assert.equal(placeFit("Brooklyn", { city: "San Francisco" }), "away");
});

test("One card per host: the same person twice in one city merges, different people don't", () => {
  assert.ok(sameHost({ name: "Tram", city: "Brooklyn", person: "Tram" }, { name: "Tram's Matcha Table", city: "Brooklyn", person: "Tram" }));
  assert.ok(sameHost({ name: "Claire's Run Crew", city: "Brooklyn" }, { name: "Claire's Run Crew", city: "New York" }));
  assert.ok(!sameHost({ name: "Claire's Run Crew", city: "Brooklyn" }, { name: "Claire's Bakery", city: "Brooklyn" }));
  assert.ok(!sameHost({ name: "Tram", city: "Brooklyn" }, { name: "Tram", city: "San Francisco" }));
  const P = cleanProof({ pastEvents: [{ companyType: "Fintech", companySize: "51-200", format: "Matcha workshop", headcount: "40" }, {}], socials: [{ platform: "instagram", handle: "@tram", followers: "12,400" }, { platform: "myspace", handle: "x" }], coi: { url: "https://evil.example/x.pdf", expires: "2027-01-31" } });
  assert.equal(P.pastEvents.length, 1); assert.equal(P.pastEvents[0].headcount, 40); assert.deepEqual(P.socials, [{ platform: "instagram", handle: "tram", followers: 12400 }]); assert.deepEqual(P.coi, { url: "", expires: "2027-01-31" });
});

let srv; before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "trust-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; srv = await startServer(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR"]) delete process.env[k]; await srv.close(); });
async function signup(email, name) { const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "long-password-1", name, mode: "friends" }) }); return (r.headers.get("set-cookie") || "").split(";")[0]; }
test("A host's proof and trust come from one endpoint; /teams and /hosts/book never make an example the best match", async () => {
  const c = await signup("trust-host@example.com", "Hana Ito"); assert.ok(c, "signed up");
  const post = (u, b) => fetch(srv.base + u, { method: "POST", headers: { "Content-Type": "application/json", cookie: c }, body: JSON.stringify(b) });
  const pr = await post("/api/host/profile", { forHire: true, handle: "hana-counter", name: "Hana's Counter", city: "Manhattan", tagline: "Omakase for small groups", emoji: "🍣", experiences: [{ name: "Omakase roundtable for 12", desc: "Ten courses at one counter, one conversation.", category: "dining", min: 8, max: 12, seated: 12, price: "$240 a person" }] });
  assert.ok(pr.ok, await pr.text());
  assert.ok((await post("/api/host/proof", { pastEvents: [{ companyType: "Bank", format: "Client dinner", headcount: 12 }], socials: [{ platform: "instagram", handle: "hana", followers: 5200 }] })).ok);
  const T = await (await fetch(srv.base + "/api/public/host/hana-counter/trust")).json();
  assert.equal(T.pastCorporate[0].label, "Added by the host"); assert.equal(T.socials[0].label, "Self-reported"); assert.equal(T.insurance.text, "Insurance: ask the host"); assert.ok(T.isNewHere);
  const M = await (await fetch(srv.base + "/api/public/teams/match?city=Manhattan&people=14&goal=exec")).json();
  assert.equal(M.results[0]?.host.handle, "hana-counter"); assert.ok(M.results.every((r) => !r.example)); assert.equal(M.audience, "your guests"); assert.ok(M.recruit, "fewer than three: say so");
  const B = await (await fetch(srv.base + "/api/public/hosts/book?city=Manhattan")).json(); assert.ok(B.hosts.some((h) => h.handle === "hana-counter" && h.options.length === 1)); assert.ok(B.hosts.every((h) => !h.example));
  const S = await (await fetch(srv.base + "/api/public/teams/series-coverage?cities=Manhattan,Austin")).json();
  assert.equal(S.cities[0].hosts, 1); assert.equal(S.cities[1].hosts, 0); assert.ok(S.cities[1].kit.price);
  // a team vote holds exactly the shortlist the organizer saw: the same options, never an example
  const V = await (await post("/api/public/teams/vote", { ids: M.results.map((r) => r.experience.id), query: { city: "Manhattan", people: 14, goal: "exec" } })).json(); assert.ok(V.ok, JSON.stringify(V));
  const D = await (await fetch(srv.base + "/api/public/teams/saved/" + V.id)).json();
  assert.deepEqual(D.results.map((r) => r.experience.id), M.results.map((r) => r.experience.id)); assert.ok(D.results.every((r) => !r.example));
  assert.equal((await fetch(srv.base + "/api/public/teams/saved/" + V.id + "/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pick: M.results[0].experience.id, name: "Ana", who: "w1" }) })).status, 200);
});
