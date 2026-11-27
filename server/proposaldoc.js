// Drawing a brand proposal (server/proposals.js): the document as HTML (the builder's live preview and the brand's page
// use the same one), the brand's page around it, the PDF (one page or the full proposal, drawn on the server with
// jsPDF, the Pottery Lab signature in every page footer) and the link card (server/sharecards.js).
//
// The host owns the document: their accent, logo and photo. Pottery Lab owns the frame: the small mark, the
// "Powered by Pottery Lab" signature and the labels ("Verified by Pottery Lab", "Host-provided", "Estimate",
// "Example"), which a host's kit never restyles.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { money } from "./brandbook.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const para = (s) => esc(s).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
const HEX = (h, d) => (/^#[0-9a-f]{6}$/i.test(h || "") ? h : d);
const monthOf = (m) => (/^\d{4}-\d{2}$/.test(m || "") ? new Date(m + "-15T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "");
const dayOf = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
export const SIGN = { powered: "Powered by Pottery Lab", line: "Booked and paid through Pottery Lab" };
export const MARK = '<svg class="pp-mark" viewBox="0 0 48 48" aria-hidden="true"><rect x="4" y="4" width="40" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="3"/><path d="M17 11h14M19 11v4l-6 6v9a7 7 0 0 0 7 7h8a7 7 0 0 0 7-7v-9l-6-6v-4" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><circle cx="20.5" cy="26" r="2.2" fill="#29489A"/><circle cx="27.5" cy="26" r="2.2" fill="#29489A"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l7 2.6v5.4c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6.1z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const verified = (V) => (V.proof.example ? '<span class="pp-tag ex">Example numbers</span>' : `<span class="pp-ver">${CHECK}Verified by Pottery Lab</span>`);
const hostSaid = '<span class="pp-tag host">Host-provided</span>';
const hostLink = (V) => `${V.origin || ""}/@${encodeURIComponent(V.host.handle)}`;

/** The proposal itself. V comes from viewOf() in server/proposals.js. */
export function docHtml(V) {
  const H = V.host, B = V.brand, k = H.kit || {}, style = `--k-accent:${HEX(k.accent, "#29489A")};--k-accent-text:${HEX(k.accentText, "#29489A")};--k-on:${HEX(k.onAccent, "#FFFFFF")}`;
  const who = H.person && H.person.toLowerCase() !== String(H.name).toLowerCase() ? H.person : H.name, out = [];
  if (V.example) out.push(`<p class="pp-example" role="note"><b>Example</b> This is an example proposal from an example host, so you can see how one reads. The host, numbers and quotes are made up.</p>`);
  // cover
  const meta = [B.name ? `For ${esc(B.name)}` : "", B.occasion && B.occasion !== V.cover.sub ? esc(B.occasion) : "", B.date ? esc(dayOf(B.date)) : "", V.plan.guests ? `${V.plan.guests} guests` : ""].filter(Boolean);
  out.push(`<header class="pp-cover" id="cover"><div class="pp-cover__band"></div><div class="pp-cover__in">${H.kit?.logo ? `<img class="pp-logo" src="${esc(H.kit.logo)}" alt="${esc(H.name)}">` : `<span class="pp-mono" aria-hidden="true">${esc((H.name || "?").slice(0, 1).toUpperCase())}</span>`}
    <p class="pp-kicker">Proposal from ${esc(H.name)}</p><h1>${esc(V.cover.title || `A proposal for ${B.name || "your team"}`)}</h1>${V.cover.sub ? `<p class="pp-sub">${esc(V.cover.sub)}</p>` : ""}
    ${meta.length ? `<p class="pp-meta">${meta.map((m) => `<span>${m}</span>`).join("")}</p>` : ""}</div>${H.photo && V.about?.photo !== "" ? `<img class="pp-cover__ph" src="${esc(V.about?.photo || H.photo)}" alt="">` : ""}</header>`);
  // about
  if (V.about.on !== false && V.about.text) out.push(`<section class="pp-sec" id="about"><h2>About ${esc(who)}</h2><div class="pp-about">${V.about.photo ? `<img src="${esc(V.about.photo)}" alt="${esc(who)}">` : ""}<div>${para(V.about.text)}${H.city ? `<p class="pp-meta"><span>${esc([H.hood, H.city].filter(Boolean).join(", "))}</span><span><a href="${esc(hostLink(V))}">${esc(H.name)} on Pottery Lab</a></span></p>` : ""}</div></div></section>`);
  // proof
  const P = V.proof;
  if (P.on !== false) { const real = P.stats.length > 0, fresh = P.isNew;
    out.push(`<section class="pp-sec" id="proof"><h2>${fresh ? "First brand partnership" : `${esc(H.name)} on Pottery Lab`}</h2>
      ${fresh ? `<p class="pp-lede">This would be ${esc(who)}'s first brand partnership on Pottery Lab.${real ? " Here's what's on the platform so far." : " Here's what they've done before, in their own words."}</p>` : ""}
      ${real ? `<ul class="pp-stats">${P.stats.map((s) => `<li><b>${esc(s.n)}</b><span>${esc(s.label)}</span></li>`).join("")}</ul><p class="pp-src">${verified(V)} <span>Counted from real events and replies on Pottery Lab.</span></p>` : ""}
      ${P.quotes.length ? `<div class="pp-quotes">${P.quotes.map((q) => `<figure><blockquote>“${esc(q.text)}”</blockquote><figcaption>${esc(q.name)}${q.event ? `, ${esc(q.event)}` : ""}${q.month ? ` · ${esc(monthOf(q.month))}` : ""} ${q.example ? '<span class="pp-tag ex">Example</span>' : '<span class="pp-ver sm">' + CHECK + "Kudos on Pottery Lab</span>"}</figcaption></figure>`).join("")}</div>` : ""}
      ${P.recent?.length ? `<p class="pp-meta"><span>Recently:</span>${P.recent.map((r) => `<span>${esc(r.title)}${r.month ? `, ${esc(monthOf(r.month))}` : ""}</span>`).join("")}</p>` : ""}
      ${P.offline.length ? `<div class="pp-offline"><h3>Before Pottery Lab ${hostSaid}</h3><ul>${P.offline.map((o) => `<li><b>${esc(o.what)}</b>${[o.when, o.people].filter(Boolean).length ? ` <span>${esc([o.when, o.people].filter(Boolean).join(" · "))}</span>` : ""}</li>`).join("")}</ul><p class="pp-src">Told to us by ${esc(who)}. Not checked by Pottery Lab.</p></div>` : ""}
      ${P.note ? `<div class="pp-note">${para(P.note)} ${hostSaid}</div>` : ""}</section>`); }
  // the idea
  const I = V.idea; if (I.on !== false && I.concepts.length) out.push(`<section class="pp-sec" id="idea"><h2>The idea</h2><div class="pp-concepts">${I.concepts.map((c, i) => `<article class="pp-concept${i === I.pick ? " is-pick" : ""}">${i === I.pick && I.concepts.length > 1 ? `<span class="pp-tag pick">${esc(who)}'s pick</span>` : `<span class="pp-tag">Option ${i + 1}</span>`}<h3>${esc(c.name)}</h3><p class="pp-line">${esc(c.line)}</p>${c.experience ? `<h4>For guests</h4>${para(c.experience)}` : ""}${c.brand ? `<h4>How ${esc(B.name || "your brand")} shows up</h4>${para(c.brand)}` : ""}</article>`).join("")}</div></section>`);
  // the plan
  const L = V.plan; if (L.on !== false) { const pr = L.presence || {};
    out.push(`<section class="pp-sec" id="plan"><h2>The plan</h2>${L.ros.length ? `<h3>Run of show</h3><ol class="pp-ros">${L.ros.map((r) => `<li><span>${esc(r.time)}</span>${esc(r.what)}</li>`).join("")}</ol>` : ""}
      <div class="pp-grid">${L.includes.length ? `<div><h3>What's included</h3><ul class="pp-ticks">${L.includes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      <div><h3>Guests and place</h3><p><b>${L.guests} guests</b> <span class="pp-tag">Estimate</span></p>${L.venues.length ? `<ul class="pp-plain">${L.venues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>
      ${L.access ? `<div><h3>Access</h3>${para(L.access)}</div>` : ""}${L.diets ? `<div><h3>Food and dietary needs</h3>${para(L.diets)}</div>` : ""}</div>
      ${pr.signage || pr.sampling || pr.photos ? `<h3>How ${esc(B.name || "your brand")} shows up</h3><dl class="pp-dl">${pr.signage ? `<dt>Signage</dt><dd>${esc(pr.signage)}</dd>` : ""}${pr.sampling ? `<dt>Product</dt><dd>${esc(pr.sampling)}</dd>` : ""}${pr.photos ? `<dt>Photos, with guests' consent</dt><dd>${esc(pr.photos)}</dd>` : ""}</dl>` : ""}</section>`); }
  // packages and pricing
  const R = V.pricing; if (R.on !== false && R.tiers.length) out.push(`<section class="pp-sec" id="pricing"><h2>Packages and pricing</h2><div class="pp-tiers n${R.tiers.length}">${R.tiers.map((t, i) => `<article class="pp-tier${i === R.recommend ? " is-rec" : ""}" data-tier="${i}">${i === R.recommend && R.tiers.length > 1 ? `<span class="pp-tag pick">${esc(who)}'s pick</span>` : ""}<h3>${esc(t.name)}</h3><p class="pp-line">${esc(t.line)}</p>
      <p class="pp-total"><b>${money(t.price.totalCents)}</b><span>for ${t.price.headcount} guests <span class="pp-tag">Estimate</span></span></p>
      ${t.includes.length ? `<ul class="pp-ticks">${t.includes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <table class="pp-lines">${t.price.lines.map((l) => `<tr><td>${esc(l.label)}${l.note ? `<small>${esc(l.note)}</small>` : ""}</td><td>${money(l.cents)}</td></tr>`).join("")}<tr class="sum"><td>Total</td><td>${money(t.price.totalCents)}</td></tr></table>
      <ul class="pp-pay">${t.price.schedule.map((s) => `<li><span>${esc(s.when)}</span><b>${money(s.cents)}</b><small>${esc(s.what)}</small></li>`).join("")}</ul>
      ${t.price.optional.length ? `<p class="pp-meta"><span>Add if you like:</span>${t.price.optional.map((a) => `<span>${esc(a.name)}, ${esc(a.text)}</span>`).join("")}</p>` : ""}</article>`).join("")}</div>
    <p class="pp-src">Totals are estimates for ${R.tiers[0].price.headcount} guests and change with the final number, agreed a week before. Paid through Pottery Lab: the deposit when you accept, the rest 7 days before.</p>
    ${R.notIncluded.length ? `<h3>Not included</h3><ul class="pp-plain">${R.notIncluded.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</section>`);
  // timeline
  const T = V.timeline; if (T.on !== false && T.steps.length) out.push(`<section class="pp-sec" id="timeline"><h2>From yes to the night</h2><ol class="pp-steps">${T.steps.map((s) => `<li><b>${esc(s.when)}</b><span>${esc(s.what)}</span></li>`).join("")}</ol></section>`);
  // terms
  const Z = V.terms; if (Z.on !== false) out.push(`<section class="pp-sec" id="terms"><h2>Terms</h2><h3>Cancellation: ${esc(Z.label)}</h3><ul class="pp-plain">${Z.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p>${esc(Z.deposit)}</p>
    ${Z.usage ? `<h3>Using the photos</h3>${para(Z.usage)}` : ""}${Z.insurance ? `<h3>Insurance</h3>${para(Z.insurance)}<p class="pp-src">A question to confirm together, not legal advice.</p>` : ""}${Z.extra ? `<h3>Also</h3>${para(Z.extra)}` : ""}</section>`);
  // next step
  out.push(`<section class="pp-sec pp-nextsec" id="next"><h2>Next step</h2><p class="pp-next">${esc(V.next.label)}</p><p>${V.next.primary === "accept" ? `Pick a package and accept. The deposit holds ${B.date ? esc(dayOf(B.date)) : "the date"}, and everything after happens in one thread on Pottery Lab.` : V.next.primary === "call" ? "Book a time to talk it through, then accept here when you're ready." : "Send a question and I'll answer in the same thread, usually within a day."}</p></section>`);
  // signature
  out.push(`<footer class="pp-sign" id="signature"><div class="pp-sign__host"><p class="pp-sign__name">${esc(who)}${who !== H.name ? `, ${esc(H.name)}` : ""}</p><p><a href="${esc(hostLink(V))}">${esc(H.name)} on Pottery Lab</a></p></div>
    <a class="pp-pl" href="${esc(hostLink(V))}">${MARK}<span><b>${SIGN.powered}</b><small>${SIGN.line}</small></span></a></footer>`);
  return `<article class="pp-doc${V.example ? " is-example" : ""}" style="${style}">${out.join("\n")}</article>`;
}

/** The brand's page: the document in the Pottery Lab frame, the answer buttons, the PDFs, noindex. */
export function pageHtml(V, { example = false, signedIn = false, brandSide = false, isHost = false, answered = null } = {}) {
  const base = example ? `/proposals/example/${V.template.id}` : `/p-brand/${V.token}`, title = `${V.cover.title || "A proposal"} · ${V.host.name}`, desc = V.idea.concepts[V.idea.pick]?.line || V.cover.sub || "";
  const tiers = V.pricing.on !== false ? V.pricing.tiers : [], closed = answered?.action === "accept" || answered?.action === "decline";
  const panel = example ? `<aside class="pp-answer is-example"><p><b>This is an example.</b> Brands answer a real proposal here: accept and pay the deposit, ask a question, or decline.</p><a class="pp-btn primary" href="/proposals/new">Make your own proposal</a></aside>`
    : isHost ? `<aside class="pp-answer"><p><b>This is how the brand sees it.</b> ${V.status === "accepted" ? "They accepted." : V.status === "declined" ? "They passed this time." : "Answers show on your proposals page."}</p><a class="pp-btn" href="/proposals/${esc(V.id)}/edit">Back to editing</a></aside>`
    : closed ? `<aside class="pp-answer" id="answer"><p><b>${answered.action === "accept" ? `Accepted${answered.tier ? `: ${esc(answered.tier)}` : ""}.` : "You passed on this one."}</b> ${answered.action === "accept" ? "Your booking, the deposit and messages are in Bookings." : "Thanks for letting the host know."}</p>${answered.action === "accept" ? '<a class="pp-btn primary" href="/teams/bookings">Open your bookings</a>' : ""}</aside>`
    : `<aside class="pp-answer" id="answer" data-token="${esc(V.token)}" data-signed="${signedIn ? 1 : 0}">
      ${tiers.length > 1 ? `<fieldset class="pp-pick"><legend>Pick a package</legend>${tiers.map((t, i) => `<label><input type="radio" name="tier" value="${i}"${i === V.pricing.recommend ? " checked" : ""}><span><b>${esc(t.name)}</b> ${money(t.price.totalCents)}<small>${money(t.price.depositCents)} deposit</small></span></label>`).join("")}</fieldset>` : tiers.length ? `<input type="hidden" name="tier" value="0">` : ""}
      <div class="pp-acts">${V.next.primary === "call" && V.next.callUrl ? `<a class="pp-btn primary" href="${esc(V.next.callUrl)}" target="_blank" rel="noopener">Book a call</a>` : ""}
      ${tiers.length ? `<button class="pp-btn ${V.next.primary === "accept" ? "primary" : ""}" type="button" data-act="accept">Accept and pay the deposit</button>` : ""}
      ${V.next.question !== false || V.next.primary === "question" ? `<button class="pp-btn ${V.next.primary === "question" ? "primary" : ""}" type="button" data-act="ask">Ask a question</button>` : ""}
      <button class="pp-btn quiet" type="button" data-act="decline">Decline</button></div>
      <form class="pp-ask" hidden><label for="pp-q">Your question</label><textarea id="pp-q" maxlength="1000" rows="3" placeholder="Ask about dates, the menu, anything"></textarea><button class="pp-btn primary" type="submit">Send</button></form>
      <p class="pp-msg" role="status" aria-live="polite"></p>${brandSide || !signedIn ? "" : ""}</aside>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${esc((V.origin || "") + base + "/og.png")}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/system.css"><link rel="stylesheet" href="/proposals.css"></head>
<body class="pp-body"><header class="pp-bar"><a class="pp-bar__pl" href="/">${MARK}<span>pottery lab</span></a><span class="pp-bar__what">${example ? '<span class="pp-tag ex">Example</span>' : "Proposal"}</span><nav class="pp-bar__pdf" aria-label="Download"><a href="${esc(base)}/pdf?pages=one">1-page PDF</a><a href="${esc(base)}/pdf">Full PDF</a></nav></header>
<main class="pp-main" id="main">${docHtml(V)}${panel}</main>
<div class="pp-printfoot" aria-hidden="true">${MARK}<span><b>${SIGN.powered}</b> · ${SIGN.line} · ${esc(hostLink(V).replace(/^https?:\/\//, ""))}${example ? " · Example" : ""}</span></div>
${example || isHost || closed ? "" : `<div class="pp-dock" id="dock"><a class="pp-btn primary" href="#answer">Answer this proposal</a></div><script>${ANSWER_JS}</script>`}</body></html>`;
}
// the answer panel: accept goes to the booking (deposit next), a question to the thread, decline says so
const ANSWER_JS = `(function(){var A=document.getElementById("answer");if(!A)return;var t=A.dataset.token,m=A.querySelector(".pp-msg"),f=A.querySelector(".pp-ask");
function tier(){var r=A.querySelector("input[name=tier]:checked")||A.querySelector("input[name=tier]");return r?+r.value:0}
function say(h){m.innerHTML=h}
async function go(action,text){say("Sending…");try{var r=await fetch("/api/p-brand/"+encodeURIComponent(t)+"/respond",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:action,tier:tier(),text:text||""})}),j=await r.json().catch(function(){return{}});
if(r.status===401){say(j.message+' <a href="'+j.login+'">Sign in</a> or <a href="/signup?mode=work&next='+encodeURIComponent(location.pathname)+'">make a work account</a>.');return}
if(!r.ok){say(j.message||"That didn't go through. Try again.");return}
if(action==="accept"){say("Accepted. Taking you to the deposit…");location.href=j.url;return}
if(action==="question"){f.hidden=true;say('Sent. The host answers in your <a href="'+j.url+'">booking thread</a>.');return}
A.querySelector(".pp-acts").hidden=true;var p=A.querySelector(".pp-pick");if(p)p.hidden=true;say("Thanks for letting them know. You passed on this one.")}catch(e){say("No connection. Try again in a moment.")}}
var dk=document.getElementById("dock");if(dk&&"IntersectionObserver"in window)new IntersectionObserver(function(es){dk.classList.toggle("is-off",es[0].isIntersecting)}).observe(A);
A.addEventListener("click",function(e){var b=e.target.closest("[data-act]");if(!b)return;var a=b.dataset.act;if(a==="ask"){f.hidden=!f.hidden;if(!f.hidden)f.querySelector("textarea").focus();return}if(a==="decline"&&!confirm("Pass on this proposal? The host will see you declined."))return;go(a)});
f.addEventListener("submit",function(e){e.preventDefault();var v=f.querySelector("textarea").value.trim();if(v.length<3){say("Write your question first.");return}go("question",v)})})();`;

/** The link card (1200 x 630) for the proposal link. */
export function ogSpec(V) { const c = V.idea.concepts[V.idea.pick] || {};
  return { tone: "linen", kicker: V.example ? "Example proposal" : `A proposal for ${V.brand.name || "your team"}`, title: c.name || V.cover.title || "A proposal", sub: `from ${V.host.name}`, body: c.line || V.cover.sub || "",
    stats: V.proof.example ? [] : V.proof.stats.slice(0, 2).map((s) => ({ n: s.n, label: s.label })), foot: V.example ? "Example · Powered by Pottery Lab" : SIGN.powered, accent: HEX(V.host.kit?.accent, "#29489A") }; }

// ---------------------------------------------------------------------------------------------------------------
// The PDF: US Letter, the host's accent on the cover band, the Pottery Lab signature in every footer.
let jsPDFCtor = null;
const jsPDF = () => (jsPDFCtor ||= createRequire(import.meta.url)("jspdf").jsPDF);
/** Only what the PDF's standard fonts can draw: curly quotes, dashes and ellipses made plain, anything outside Latin-1 dropped. */
export const pdfText = (s) => String(s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/…/g, "...").replace(/ /g, " ").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");
const rgb = (h) => { const n = parseInt(HEX(h, "#29489A").slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const INK = [27, 29, 28], SOFT = [68, 72, 69], LINE = [207, 200, 185], LINEN = [239, 235, 226], BLUE = [41, 72, 154];

export function pdfOf(V, { one = false, assetsDir = "" } = {}) {
  const D = new (jsPDF())({ unit: "pt", format: "letter" }), W = 612, Hh = 792, M = 54, CW = W - M * 2, FOOT = 742, acc = rgb(V.host.kit?.accent);
  let y = M;
  const color = (c) => D.setTextColor(c[0], c[1], c[2]);
  const font = (f = "helvetica", s = "normal", z = 11) => { D.setFont(f, s); D.setFontSize(z); };
  const room = (h) => { if (y + h > FOOT - 14) { if (one) return false; D.addPage(); y = M; } return true; };
  const text = (t, { f = "helvetica", s = "normal", z = 11, c = INK, w = CW, x = M, lh = 1.4, max = 0 } = {}) => { font(f, s, z); color(c); let L = D.splitTextToSize(pdfText(t), w); if (max && L.length > max) { L = L.slice(0, max); L[max - 1] = L[max - 1].replace(/\s*\S*$/, "") + "..."; }
    for (const l of L) { if (!room(z * lh)) return; D.text(l, x, y + z); y += z * lh; } };
  const head = (t) => { if (!room(48)) return; y += 14; D.setDrawColor(...INK); D.setLineWidth(1.2); D.line(M, y, M + CW, y); y += 12; text(t, { f: "helvetica", s: "bold", z: one ? 14 : 18, lh: 1.25 }); y += 4; };
  const sub = (t) => { room(28); y += 6; text(t, { s: "bold", z: 11 }); };
  const kicker = (t, c = acc) => text(String(t).toUpperCase(), { f: "courier", s: "bold", z: 9, c });
  const bullet = (t, o = {}) => { const x0 = o.x || M; font("helvetica", "normal", 10.5); if (!room(15)) return; color(SOFT); D.text("-", x0, y + 10.5); text(t, { z: 10.5, x: x0 + 10, w: (o.w || CW) - 10, ...o, x: x0 + 10 }); };
  const who = V.host.person && V.host.person.toLowerCase() !== String(V.host.name).toLowerCase() ? V.host.person : V.host.name, B = V.brand;
  const tag = (t, x, yy, c = SOFT) => { font("courier", "bold", 8); const w = D.getTextWidth(t) + 8; D.setDrawColor(...c); D.setLineWidth(0.7); D.roundedRect(x, yy - 8, w, 11, 2, 2, "S"); color(c); D.text(t, x + 4, yy); return w; };

  // cover band
  D.setFillColor(...LINEN); D.rect(0, 0, W, one ? 150 : 250, "F"); D.setFillColor(...acc); D.rect(0, 0, W, 8, "F");
  let ph = null; try { const u = V.about?.photo || V.host.photo; if (assetsDir && /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "")) { const id = u.split("/").pop(), meta = JSON.parse(fs.readFileSync(path.join(assetsDir, id + ".json"), "utf8")), kind = /png/i.test(meta.contentType) ? "PNG" : /jpe?g/i.test(meta.contentType) ? "JPEG" : ""; if (kind) ph = { data: new Uint8Array(fs.readFileSync(path.join(assetsDir, id))), kind }; } } catch {}
  const textW = ph && !one ? CW - 170 : CW;
  y = one ? 36 : 64;
  if (V.example) { tag("EXAMPLE", M, y + 2, acc); y += 16; }
  kicker(`Proposal from ${V.host.name}`); y += 4;
  text(V.cover.title || `A proposal for ${B.name || "your team"}`, { f: "times", s: "bold", z: one ? 24 : 32, lh: 1.12, w: textW, max: 2 });
  if (V.cover.sub) { y += 2; text(V.cover.sub, { z: one ? 11 : 13, c: SOFT, w: textW, max: 2 }); }
  const meta = [B.name && `For ${B.name}`, B.occasion !== V.cover.sub && B.occasion, B.date && dayOf(B.date), V.plan.guests && `${V.plan.guests} guests`].filter(Boolean).join("  ·  ");
  if (meta) { y += 6; text(meta, { z: 10, c: SOFT, w: textW, max: 2 }); }
  if (ph && !one) { try { D.addImage(ph.data, ph.kind, W - M - 150, 56, 150, 150, undefined, "FAST"); } catch {} }
  y = Math.max(y, one ? 150 : 250) + 8;

  const P = V.proof, I = V.idea, R = V.pricing, pick = I.concepts[I.pick] || I.concepts[0], rec = R.tiers[R.recommend] || R.tiers[0];
  const stats = () => { if (!P.stats.length) return; const S = P.stats.slice(0, one ? 3 : 6), cols = 3, cw = (CW - (cols - 1) * 10) / cols;
    for (let i = 0; i < S.length; i += cols) { if (!room(52)) return; S.slice(i, i + cols).forEach((s, j) => { const x = M + j * (cw + 10); D.setDrawColor(...INK); D.setLineWidth(1); D.roundedRect(x, y, cw, 46, 4, 4, "S"); font("helvetica", "bold", 18); color(INK); D.text(pdfText(s.n), x + 10, y + 21); font("helvetica", "normal", 8.5); color(SOFT); D.text(D.splitTextToSize(pdfText(s.label), cw - 20).slice(0, 2), x + 10, y + 33); }); y += 54; }
    if (room(14)) { const w = tag(P.example ? "EXAMPLE NUMBERS" : "VERIFIED BY POTTERY LAB", M, y + 9, P.example ? acc : BLUE); font("helvetica", "normal", 9); color(SOFT); D.text("Counted from real events and replies on Pottery Lab.", M + w + 6, y + 9); y += 16; } };

  if (one) {
    head(`${I.on !== false && pick ? pick.name : "The idea"}`);
    if (pick) { text(pick.line, { z: 11, max: 2 }); if (pick.experience) text(pick.experience, { z: 10, c: SOFT, max: 3 }); if (pick.brand) text(`How ${B.name || "your brand"} shows up: ${pick.brand}`, { z: 10, c: SOFT, max: 2 }); }
    if (P.on !== false) { head(P.isNew ? "First brand partnership" : `${V.host.name} on Pottery Lab`); if (P.isNew) text(`This would be ${who}'s first brand partnership on Pottery Lab.`, { z: 10, c: SOFT }); stats();
      if (P.offline.length) { text(`Before Pottery Lab (host-provided): ${P.offline.slice(0, 3).map((o) => o.what).join("; ")}`, { z: 10, c: SOFT, max: 2 }); } }
    if (R.on !== false && rec) { head("The price"); text(`${rec.name}: ${rec.line}`, { s: "bold", z: 11, max: 1 }); text(`${money(rec.price.totalCents)} for ${rec.price.headcount} guests (estimate). ${money(rec.price.depositCents)} deposit when you accept, ${money(rec.price.balanceCents)} 7 days before.`, { z: 10.5, max: 2 });
      if (R.tiers.length > 1) text(`Also: ${R.tiers.filter((t) => t !== rec).map((t) => `${t.name} ${money(t.price.totalCents)}`).join(", ")}.`, { z: 10, c: SOFT, max: 1 }); }
    head("Next step"); text(`${V.next.label}. Terms: ${V.terms.label} cancellation. The full proposal has the run of show, timeline and terms.`, { z: 10.5, max: 2 });
  } else {
    if (V.about.on !== false && V.about.text) { head(`About ${who}`); text(V.about.text, { z: 11 }); }
    if (P.on !== false) { head(P.isNew ? "First brand partnership" : `${V.host.name} on Pottery Lab`); if (P.isNew) { text(`This would be ${who}'s first brand partnership on Pottery Lab.`, { z: 11, c: SOFT }); y += 4; } stats();
      for (const q of P.quotes) { if (!room(40)) break; text(`"${q.text}"`, { f: "times", s: "italic", z: 12 }); text(`${q.name}${q.event ? `, ${q.event}` : ""}${q.example ? " (example)" : " (kudos on Pottery Lab)"}`, { z: 9, c: SOFT }); y += 4; }
      if (P.offline.length) { sub("Before Pottery Lab"); const w = tag("HOST-PROVIDED", M, y + 9); y += 14; for (const o of P.offline) bullet(`${o.what}${[o.when, o.people].filter(Boolean).length ? ` (${[o.when, o.people].filter(Boolean).join(", ")})` : ""}`); text(`Told to us by ${who}. Not checked by Pottery Lab.`, { z: 9, c: SOFT }); void w; }
      if (P.note) { y += 4; text(`${P.note} (host-provided)`, { z: 10, c: SOFT }); } }
    if (I.on !== false && I.concepts.length) { head("The idea"); I.concepts.forEach((c, i) => { room(60); y += 4; text(`${i === I.pick && I.concepts.length > 1 ? `${who}'s pick: ` : `Option ${i + 1}: `}${c.name}`, { f: "times", s: "bold", z: 14 }); text(c.line, { z: 11 }); if (c.experience) text(`For guests: ${c.experience}`, { z: 10, c: SOFT }); if (c.brand) text(`How ${B.name || "your brand"} shows up: ${c.brand}`, { z: 10, c: SOFT }); }); }
    const L = V.plan; if (L.on !== false) { head("The plan");
      if (L.ros.length) { sub("Run of show"); for (const r of L.ros) { if (!room(15)) break; font("courier", "bold", 10); color(acc); D.text(pdfText(r.time), M, y + 10); text(r.what, { z: 10.5, x: M + 56, w: CW - 56 }); } }
      if (L.includes.length) { sub("What's included"); L.includes.forEach((x) => bullet(x)); }
      sub("Guests and place"); text(`${L.guests} guests (estimate)${L.venues.length ? `. ${L.venues.join("; ")}` : ""}`, { z: 10.5 });
      if (L.access) { sub("Access"); text(L.access, { z: 10.5 }); } if (L.diets) { sub("Food and dietary needs"); text(L.diets, { z: 10.5 }); }
      const pr = L.presence || {}; if (pr.signage || pr.sampling || pr.photos) { sub(`How ${B.name || "your brand"} shows up`); if (pr.signage) bullet(`Signage: ${pr.signage}`); if (pr.sampling) bullet(`Product: ${pr.sampling}`); if (pr.photos) bullet(`Photos, with guests' consent: ${pr.photos}`); } }
    if (R.on !== false && R.tiers.length) { head("Packages and pricing");
      R.tiers.forEach((t, i) => { if (!room(80)) return; y += 4; text(`${t.name}${i === R.recommend && R.tiers.length > 1 ? ` (${who}'s pick)` : ""}: ${t.line}`, { s: "bold", z: 12 });
        for (const l of t.price.lines) { if (!room(14)) break; font("helvetica", "normal", 10); color(SOFT); D.text(D.splitTextToSize(pdfText(l.label), CW - 110)[0], M + 10, y + 10); color(INK); D.text(money(l.cents), M + CW, y + 10, { align: "right" }); y += 14; }
        D.setDrawColor(...LINE); D.setLineWidth(0.6); D.line(M + 10, y + 2, M + CW, y + 2); y += 4; font("helvetica", "bold", 11); color(INK); D.text(`Total for ${t.price.headcount} guests (estimate)`, M + 10, y + 11); D.text(money(t.price.totalCents), M + CW, y + 11, { align: "right" }); y += 16;
        text(t.price.schedule.map((s) => `${s.when}: ${money(s.cents)}`).join("   ·   "), { z: 9.5, c: SOFT, x: M + 10, w: CW - 10 });
        if (t.includes.length) text(`Includes: ${t.includes.join(", ")}`, { z: 9.5, c: SOFT, x: M + 10, w: CW - 10 }); if (t.price.optional.length) text(`Add if you like: ${t.price.optional.map((a) => `${a.name}, ${a.text}`).join("; ")}`, { z: 9.5, c: SOFT, x: M + 10, w: CW - 10 }); });
      y += 4; text("Totals are estimates and change with the final guest number, agreed a week before. Paid through Pottery Lab.", { z: 9, c: SOFT });
      if (R.notIncluded.length) { sub("Not included"); R.notIncluded.forEach((x) => bullet(x)); } }
    const T = V.timeline; if (T.on !== false && T.steps.length) { head("From yes to the night"); for (const s of T.steps) { if (!room(15)) break; font("helvetica", "bold", 10.5); color(INK); D.text(pdfText(s.when), M, y + 10.5); text(s.what, { z: 10.5, x: M + 120, w: CW - 120 }); } }
    const Z = V.terms; if (Z.on !== false) { head("Terms"); sub(`Cancellation: ${Z.label}`); Z.lines.forEach((l) => bullet(l)); text(Z.deposit, { z: 10.5 });
      if (Z.usage) { sub("Using the photos"); text(Z.usage, { z: 10.5 }); } if (Z.insurance) { sub("Insurance"); text(Z.insurance, { z: 10.5 }); text("A question to confirm together, not legal advice.", { z: 9, c: SOFT }); } if (Z.extra) { sub("Also"); text(Z.extra, { z: 10.5 }); } }
    head("Next step"); text(V.next.label, { s: "bold", z: 12 }); text(`Open the proposal link to answer: accept and pay the deposit, ask a question, or decline.`, { z: 10.5, c: SOFT });
    room(60); y += 14; text(`${who}${who !== V.host.name ? `, ${V.host.name}` : ""}`, { f: "times", s: "bold", z: 14 });
  }

  // the footer on every page: the host's page link and the Pottery Lab signature
  const n = D.getNumberOfPages(), link = (V.origin || "https://potterylab.com") + "/@" + encodeURIComponent(V.host.handle);
  for (let i = 1; i <= n; i++) { D.setPage(i); D.setDrawColor(...LINE); D.setLineWidth(0.6); D.line(M, FOOT, M + CW, FOOT);
    const mx = M, my = FOOT + 10, s = 16 / 48; D.setDrawColor(...INK); D.setLineWidth(1); D.roundedRect(mx + 4 * s, my + 4 * s, 40 * s, 40 * s, 6 * s, 6 * s, "S");
    D.lines([[14 * s, 0]], mx + 17 * s, my + 11 * s); D.lines([[0, 4 * s], [-6 * s, 6 * s], [0, 9 * s], [7 * s, 7 * s], [8 * s, 0], [7 * s, -7 * s], [0, -9 * s], [-6 * s, -6 * s], [0, -4 * s]], mx + 19 * s, my + 11 * s);
    D.setFillColor(...BLUE); D.circle(mx + 20.5 * s, my + 26 * s, 0.9, "F"); D.circle(mx + 27.5 * s, my + 26 * s, 0.9, "F");
    font("helvetica", "bold", 8.5); color(INK); D.text(SIGN.powered, mx + 22, my + 7.5); font("helvetica", "normal", 8); color(SOFT); D.text(`${SIGN.line}${V.example ? " · Example" : ""}`, mx + 22, my + 16);
    font("helvetica", "normal", 8); color(SOFT); const ltxt = pdfText(link.replace(/^https?:\/\//, "")); D.textWithLink(ltxt, M + CW - D.getTextWidth(ltxt), my + 7.5, { url: link }); D.text(`${V.host.name ? pdfText(V.host.name) + " · " : ""}${i} of ${n}`, M + CW, my + 16, { align: "right" }); }
  D.setProperties({ title: pdfText(`${V.cover.title || "Proposal"} - ${V.host.name}`), subject: "Brand proposal", creator: SIGN.powered, author: pdfText(V.host.name) });
  return Buffer.from(D.output("arraybuffer"));
}
