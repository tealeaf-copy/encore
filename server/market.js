// The brand side: companies discover and book experience hosts (a bánh mì pop-up cart, a Vietnamese tasting menu,
// a run club host, a flower bouquet workshop). Brands browse or describe what they want; hosts reply with a quote;
// the brand accepts from a private status page.
import crypto from "node:crypto";
import { scopeStore, getWorkspace, allWorkspaceIds, DEFAULT_WS } from "./workspaces.js";
import { emailConfig, sendEmail } from "./email.js";

export const CATEGORIES = [["food", "Food carts and pop-ups"], ["dining", "Chef's tables and tasting menus"], ["movement", "Runs, hikes and movement"], ["workshop", "Hands-on workshops"], ["drinks", "Coffee, tea and drinks"], ["culture", "Music, games and culture"]];
const CAT_WORDS = { food: ["cart", "pop-up", "popup", "street food", "banh mi", "bánh mì", "food truck", "stall", "snack", "lunch", "catering", "food"], dining: ["dinner", "tasting", "omakase", "chef", "supper", "fine dining", "menu"], movement: ["run", "hike", "yoga", "walk", "bike", "climb", "active", "wellness"], workshop: ["workshop", "flower", "bouquet", "pottery", "class", "craft", "make", "candle", "ceramic"], drinks: ["coffee", "tea", "matcha", "cocktail", "wine", "cupping"], culture: ["music", "dj", "game", "trivia", "karaoke", "film"] };
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, n);
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const EMAIL_OK = (e) => /^[^\s@"<>()[\],;:]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(e || "");
export const categoryOf = (x) => (CATEGORIES.some(([k]) => k === x.category) ? x.category : Object.entries(CAT_WORDS).find(([, w]) => w.some((t) => lc(`${x.name} ${x.desc}`).includes(t)))?.[0] || "culture");
const perHead = (p) => { const m = String(p || "").replace(/,/g, "").match(/\$\s?(\d+(?:\.\d+)?)/); return m ? +m[1] : null; };

/** Read a brief like "Vietnamese food for 40 people in New York, fun and hands-on, about $3k". */
const STOP = new Set(["people", "about", "with", "team", "something", "want", "would", "like", "that", "this", "event", "events", "then", "than", "person", "persons", "plus", "half", "under", "around", "maybe", "some", "they", "their", "there", "into", "from", "what", "when", "where", "have", "need", "looking", "planning", "company", "office", "offsite", "march", "april", "june", "july", "budget", "thanks", "please", "help", "great", "really", "very", "much", "more", "less", "just"]);
const hasWord = (t, w) => new RegExp(`(^|[^a-zà-ỹ])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?($|[^a-zà-ỹ])`, "i").test(t);
export function parseBrief(text) { const t = lc(text), people = +(t.match(/(\d{1,4})\s*-?\s*(?:people|ppl|guests|persons?|employees|folks|of us|attendees|pax|influencers|creators|clients|customers|staff|colleagues|members|kids|friends|editors|press)/) || [])[1] || +(t.match(/(?:team|group) of (\d{1,4})/) || [])[1] || +(t.match(/(?:for|about|around|~)\s*(\d{1,4})\b(?!\s*(?:k|%|am|pm|min|hours?|\$))/) || [])[1] || 0;
  const budget = (() => { const m = t.replace(/,/g, "").match(/\$\s?(\d+(?:\.\d+)?)\s*(k)?/); return m ? +m[1] * (m[2] ? 1000 : 1) : 0; })();
  const cats = Object.entries(CAT_WORDS).filter(([, w]) => w.some((x) => hasWord(t, x))).map(([k]) => k);
  const MONTHS = /^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)$/;
  const cm = [...String(text).matchAll(/\bin ([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)/g)].map((m) => m[1]).filter((c) => !MONTHS.test(c.split(" ")[0])), city = cm[0] || "";
  const when = (String(text).match(/\b((?:on |in )?(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,? )?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?(?: \d{1,2}(?:st|nd|rd|th)?)?)\b/) || [])[1]?.replace(/^(on|in) /, "") || "";
  const where = (String(text).match(/\b(?:at|in) (our office(?: in [A-Z][A-Za-z]+)?|the office|our studio|[A-Z][A-Za-z]+ (?:Park|Hall|Rooftop|Studio))/) || [])[1] || "";
  const words = t.split(/[^a-zà-ỹ0-9]+/).filter((w) => w.length > 3 && !STOP.has(w));
  return { people, budget, cats, city, when, where, words }; }

export function mountMarket(app, { store, small, currentUser, publicOrigin, C, X }) {
  const hits = new Map(); const limited = (req, n = 20) => { const k = (req.ip || "?") + req.path.split("/").slice(0, 4).join("/"), now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  function catalog() { const out = [];
    for (const ws of allWorkspaceIds()) { const h = C.profileOf(ws); if (!h?.handle || !(h.experiences || []).length) continue; const S = X.hostStrengths(ws), F = C.followersOf(ws).length, booked = scopeStore(store, ws).list("inquiries").filter((d) => d.data.status === "booked").length;
      for (const x of h.experiences) out.push({ id: x.id, name: x.name, desc: x.desc, emoji: x.emoji, photo: x.photo || "", includes: x.includes || [], min: x.min, max: x.max, price: x.price, perHead: perHead(x.price), length: x.length, category: categoryOf(x), travels: !!x.travels,
        host: { handle: h.handle, name: h.name, city: h.city, hood: h.hood, accent: h.theme?.accent || h.color, avatarArt: h.theme?.avatarArt || "", avatarUrl: h.theme?.avatarUrl || "", emoji: h.emoji, tagline: h.tagline || "", insured: !!h.insured, insuranceDoc: !!h.insuranceDoc, respondsIn: h.respondsIn || "", terms: h.terms || "", invoices: !!h.invoices, gigs: (h.gigs || []).slice(0, 4), gallery: (h.gallery || []).slice(0, 6) },
        trust: { events: S.events, guests: S.guests, returning: S.returning, kudos: S.kudosCount, followers: F, booked, quote: S.kudos.find((k) => k.love)?.love || "" } }); }
    return out; }
  app.get("/api/public/categories", (req, res) => res.json({ categories: CATEGORIES.map(([k, l]) => ({ key: k, label: l })) }));
  app.get("/api/public/experiences", (req, res) => { const cat = lc(req.query.category), city = lc(req.query.city), people = +req.query.people || 0;
    let L = catalog().filter((x) => (!cat || x.category === cat) && (!city || lc(`${x.host.city} ${x.host.hood}`).includes(city) || x.travels) && (!people || (people >= x.min * 0.7 && people <= x.max * 1.2)));
    L.sort((a, b) => b.trust.kudos * 2 + b.trust.guests + b.trust.booked * 5 - (a.trust.kudos * 2 + a.trust.guests + a.trust.booked * 5)); res.json({ experiences: L.slice(0, 60) }); });
  // "Tell Pip what you're planning": a ranked shortlist with reasons
  app.post("/api/public/match", small, (req, res) => { if (limited(req, 40)) return bad(res, "Slow down.", 429, "rate_limited"); const text = clean(req.body?.brief, 600); if (text.length < 6) return bad(res, "Tell Pip a little about the event.");
    const B = parseBrief(text), city = lc(B.city || req.body?.city || ""), cat0 = catalog(), knownCity = !!city && cat0.some((x) => lc(`${x.host.city} ${x.host.hood}`).includes(city));
    const L = cat0.map((x) => { let s = 0; const why = []; const blob = lc(`${x.name} ${x.desc} ${x.host.tagline} ${(x.includes || []).join(" ")}`);
      if (B.cats.includes(x.category)) { s += 4; why.push(CATEGORIES.find(([k]) => k === x.category)[1].toLowerCase()); }
      const hitWords = B.words.filter((w) => hasWord(blob, w)); if (hitWords.length) { s += Math.min(4, hitWords.length * 1.5); why.push(`"${hitWords.slice(0, 2).join(", ")}"`); }
      if (B.people) { if (B.people >= x.min && B.people <= x.max) { s += 2; why.push(`fits ${B.people}`); } else if (B.people > x.max * 1.2 || B.people < x.min * 0.6) s -= 6; }
      if (city && knownCity) { if (lc(`${x.host.city} ${x.host.hood}`).includes(city)) { s += 2; why.push(`in ${x.host.city}`); } else if (!x.travels) s -= 4; }
      if (B.budget && B.people && x.perHead) { const est = x.perHead * B.people; if (est <= B.budget * 1.1) { s += 1; why.push(`about $${Math.round(est).toLocaleString("en-US")} for ${B.people}`); } else s -= 1; }
      s += Math.min(2, x.trust.kudos * 0.3 + x.trust.booked * 0.5); return { ...x, score: s, why }; }).filter((x) => x.score > 1).sort((a, b) => b.score - a.score).slice(0, 6);
    res.json({ brief: { people: B.people, budget: B.budget, city: knownCity ? B.city : "", when: B.when, where: B.where, categories: B.cats }, matches: L }); });

  // ---- booking requests: request → quote → accept ----
  const token = (id) => crypto.createHmac("sha256", String(process.env.SESSION_SECRET || "encore-bookings")).update("booking:" + id).digest("hex").slice(0, 24);
  const findBooking = (id) => { for (const ws of allWorkspaceIds()) { const d = scopeStore(store, ws).list("inquiries").find((x) => x.data.id === id); if (d) return { ws, path: "inquiries/" + d.id, b: d.data }; } return null; };
  app.post("/api/public/book/:handle", small, async (req, res) => { if (limited(req, 8)) return bad(res, "Too many requests from here. Try later.", 429, "rate_limited");
    const ws = C.wsOfHandle(req.params.handle), h = ws && C.profileOf(ws); if (!h) return bad(res, "No host by that name.", 404, "not_found");
    const b = req.body || {}, email = lc(clean(b.email, 200)), exp = (h.experiences || []).find((x) => x.id === b.experienceId); if (!EMAIL_OK(email)) return bad(res, "Add a work email so the host can reply.");
    const people = Math.max(0, Math.min(5000, Math.round(+b.people || 0))), msg = clean(b.message, 1500); if (msg.length < 10) return bad(res, "Say a little about the occasion.");
    const id = crypto.randomBytes(6).toString("hex"), inq = { id, kind: "booking", status: "requested", name: clean(b.name, 80), company: clean(b.company, 120), email, message: msg, when: clean(b.when, 80), budget: clean(b.budget, 80), where: clean(b.where, 160), people, experience: exp ? { id: exp.id, name: exp.name, price: exp.price } : null, at: Date.now(), history: [{ at: Date.now(), by: "brand", what: "requested" }] };
    scopeStore(store, ws).add("inquiries", inq); const W = getWorkspace(ws), link = `${publicOrigin(req)}/booking/${id}?t=${token(id)}`;
    X.notify(W?.ownerEmail, { kind: "inquiry", text: `💼 ${inq.company || inq.name || "A company"} wants to book ${exp ? `"${exp.name}"` : "you"}${people ? ` for ${people}` : ""}${inq.when ? `, ${inq.when}` : ""}. Reply with a quote.`, link: `/@${h.handle}?bookings=1`, eventId: "" });
    const cfg = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true); if (cfg) { if (W?.ownerEmail) sendEmail(cfg, { to: W.ownerEmail, replyTo: email, subject: `Booking request: ${exp?.name || "an experience"}${inq.company ? ` for ${inq.company}` : ""}`, text: `${inq.name}${inq.company ? ` (${inq.company})` : ""} wants to book ${exp?.name || "you"}.\n\nWhen: ${inq.when || "-"}\nPeople: ${people || "-"}\nWhere: ${inq.where || "-"}\nBudget: ${inq.budget || "-"}\n\n${msg}\n\nReply with a quote in Encore: ${publicOrigin(req)}/@${h.handle}?bookings=1` }).catch(() => {});
      sendEmail(cfg, { to: email, subject: `Your request to ${h.name}`, text: `Thanks${inq.name ? ` ${first(inq.name)}` : ""}. ${h.name} has your request${exp ? ` for ${exp.name}` : ""} and usually replies within ${h.respondsIn || "a couple of days"}.\n\nTrack it here: ${link}`, fromName: "Encore" }).catch(() => {}); }
    res.json({ ok: true, id, status: link }); });
  app.get("/api/public/booking/:id", (req, res) => { const id = clean(req.params.id, 20); if (req.query.t !== token(id)) return bad(res, "This link isn't valid.", 403, "not_granted"); const B = findBooking(id); if (!B) return bad(res, "No such booking.", 404, "not_found"); const h = C.profileOf(B.ws);
    const { email, ...b } = B.b; res.json({ booking: b, host: { handle: h?.handle, name: h?.name, accent: h?.theme?.accent, avatarArt: h?.theme?.avatarArt || "", emoji: h?.emoji, city: h?.city || "", insured: !!h?.insured, insuranceDoc: h?.insuranceDoc || "", terms: h?.terms || "", invoices: !!h?.invoices, legalName: h?.legalName || "", taxId: h?.taxId || "", bizAddress: h?.bizAddress || "", email: getWorkspace(B.ws)?.ownerEmail || "" } }); });
  app.post("/api/public/booking/:id/billing", small, (req, res) => { const id = clean(req.params.id, 20); if (req.body?.t !== token(id)) return bad(res, "This link isn't valid.", 403, "not_granted"); const B = findBooking(id); if (!B) return bad(res, "No such booking.", 404, "not_found"); const x = req.body.billing || {};
    scopeStore(store, B.ws).update(B.path, { billing: { name: clean(x.name, 120), address: clean(x.address, 300), po: clean(x.po, 60), taxId: clean(x.taxId, 40) } }); res.json({ ok: true }); });
  app.post("/api/public/booking/:id/accept", small, (req, res) => { const id = clean(req.params.id, 20); if (req.body?.t !== token(id)) return bad(res, "This link isn't valid.", 403, "not_granted"); const B = findBooking(id); if (!B) return bad(res, "No such booking.", 404, "not_found"); if (B.b.status !== "quoted") return bad(res, "There's no quote to accept yet.");
    const S = scopeStore(store, B.ws), billing = req.body?.billing && typeof req.body.billing === "object" ? { name: clean(req.body.billing.name, 120), address: clean(req.body.billing.address, 300), po: clean(req.body.billing.po, 60), taxId: clean(req.body.billing.taxId, 40) } : B.b.billing || null;
    S.update(B.path, { status: "booked", depositPaid: !B.b.quote?.deposit, bookedAt: Date.now(), ...(billing ? { billing } : {}), history: [...(B.b.history || []), { at: Date.now(), by: "brand", what: "accepted the quote" }] });
    X.notify(getWorkspace(B.ws)?.ownerEmail, { kind: "booked", text: `🎉 ${B.b.company || B.b.name} accepted your quote for ${B.b.experience?.name || "the booking"}${B.b.when ? ` (${B.b.when})` : ""}. You're booked!`, link: `/@${C.profileOf(B.ws)?.handle}?bookings=1`, eventId: "" }); res.json({ ok: true, status: "booked" }); });
  app.post("/api/public/booking/:id/message", small, (req, res) => { if (limited(req, 30)) return bad(res, "Slow down.", 429, "rate_limited"); const id = clean(req.params.id, 20); if (req.body?.t !== token(id)) return bad(res, "This link isn't valid.", 403, "not_granted"); const B = findBooking(id); if (!B) return bad(res, "No such booking.", 404, "not_found");
    const text = clean(req.body?.text, 1000); if (!text) return bad(res, "Say something first."); scopeStore(store, B.ws).update(B.path, { thread: [...(B.b.thread || []), { by: "brand", name: first(B.b.name) || B.b.company || "Them", text, at: Date.now() }].slice(-100) });
    X.notify(getWorkspace(B.ws)?.ownerEmail, { kind: "msg", text: `💬 ${B.b.company || B.b.name}: ${text.slice(0, 100)}`, link: `/@${C.profileOf(B.ws)?.handle}?bookings=1`, eventId: "" }); res.json({ ok: true }); });
  app.post("/api/host/bookings/:id/message", small, (req, res) => { const u = me(req, res); if (!u) return; const S = scopeStore(store, u.ws), d = S.list("inquiries").find((x) => x.data.id === clean(req.params.id, 20)); if (!d) return bad(res, "No such request.", 404, "not_found"); const text = clean(req.body?.text, 1000); if (!text) return bad(res, "Say something first.");
    S.update("inquiries/" + d.id, { thread: [...(d.data.thread || []), { by: "host", name: first(u.name), text, at: Date.now() }].slice(-100) });
    const cfg = emailConfig(u.ws, false) || emailConfig(DEFAULT_WS, true), h = C.profileOf(u.ws); if (cfg && d.data.email) sendEmail(cfg, { to: d.data.email, subject: `${h?.name}: a message about your booking`, text: `${text}\n\nReply on your booking page: ${publicOrigin(req)}/booking/${d.data.id}?t=${token(d.data.id)}`, fromName: h?.name || "Encore" }).catch(() => {});
    res.json({ ok: true }); });
  app.get("/api/host/bookings", (req, res) => { const u = me(req, res); if (!u) return; res.json({ bookings: scopeStore(store, u.ws).list("inquiries").map((d) => ({ key: d.id, ...d.data, ...(d.data.id ? { link: `/booking/${d.data.id}?t=${token(d.data.id)}` } : {}) })).sort((a, b) => b.at - a.at) }); });
  app.post("/api/host/bookings/:id", small, async (req, res) => { const u = me(req, res); if (!u) return; const S = scopeStore(store, u.ws), d = S.list("inquiries").find((x) => x.data.id === clean(req.params.id, 20)); if (!d) return bad(res, "No such request.", 404, "not_found");
    const b = req.body || {}; if (b.depositPaid != null) { S.update("inquiries/" + d.id, { depositPaid: !!b.depositPaid, history: [...(d.data.history || []), { at: Date.now(), by: "host", what: b.depositPaid ? "got the deposit" : "marked the deposit unpaid" }] }); return res.json({ ok: true }); }
    const st = ["requested", "quoted", "booked", "declined", "done"].includes(b.status) ? b.status : d.data.status, quote = b.quote != null ? { total: clean(b.quote.total, 40), includes: clean(b.quote.includes, 600), note: clean(b.quote.note, 600), deposit: clean(b.quote.deposit, 40), payUrl: /^https:\/\/[^\s<>"]{3,300}$/i.test(b.quote.payUrl || "") ? b.quote.payUrl : "", invoiceNo: d.data.quote?.invoiceNo || "INV-" + d.data.id.slice(0, 6).toUpperCase() } : d.data.quote;
    S.update("inquiries/" + d.id, { status: st, ...(quote ? { quote } : {}), history: [...(d.data.history || []), { at: Date.now(), by: "host", what: st === "quoted" ? "sent a quote" : st }] });
    const h = C.profileOf(u.ws), link = `${publicOrigin(req)}/booking/${d.data.id}?t=${token(d.data.id)}`, cfg = emailConfig(u.ws, false) || emailConfig(DEFAULT_WS, true);
    if (cfg && d.data.email && (st === "quoted" || st === "declined")) sendEmail(cfg, { to: d.data.email, subject: st === "quoted" ? `${h?.name}: your quote for ${d.data.experience?.name || "the booking"}` : `${h?.name} can't take this one`, text: st === "quoted" ? `${h?.name} sent a quote: ${quote?.total || ""}\n\n${quote?.includes || ""}\n${quote?.note || ""}\n\nSee it and accept: ${link}` : `${h?.name} can't do ${d.data.when || "this date"}. Find another host: ${publicOrigin(req)}/hosts`, fromName: h?.name || "Encore" }).catch(() => {});
    res.json({ ok: true, status: st, link }); });
}
