// Shared bits for the public community pages (Discover and host pages): Pip, attendee personas, event cards.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function pipSVG(mood = "happy", size = 36) {
    const eye = (cx) => mood === "happy" ? `<path d="M${cx - 4.2} 30.5q4.2-5 8.4 0" stroke="#3A2A22" stroke-width="2.6" fill="none" stroke-linecap="round"/>` : `<ellipse cx="${cx}" cy="30" rx="3.6" ry="4.2" fill="#3A2A22"/><circle cx="${cx + 1.3}" cy="28.4" r="1.4" fill="#fff"/>`;
    return `<svg class="pip" viewBox="2 4 60 60" width="${size}" height="${size}" aria-hidden="true"><g class="pip-body">
  <path d="M13 22c-3-8 0-14 4-15 3 3 7 7 8 11z" fill="#F7A9B6"/><path d="M51 22c3-8 0-14-4-15-3 3-7 7-8 11z" fill="#F7A9B6"/>
  <path d="M15.5 18.5c-1-4 0-7 1.8-7.8 1.6 1.8 3.5 4 4.3 6z" fill="#F48CA0"/><path d="M48.5 18.5c1-4 0-7-1.8-7.8-1.6 1.8-3.5 4-4.3 6z" fill="#F48CA0"/>
  <ellipse cx="32" cy="36" rx="23" ry="21.5" fill="#FBC0C9"/><ellipse cx="32" cy="20" rx="9" ry="3" fill="#fff" opacity=".35"/>
  ${eye(22.5)}${eye(41.5)}
  <ellipse cx="15.5" cy="39" rx="4.2" ry="2.6" fill="#F48CA0" opacity=".7"/><ellipse cx="48.5" cy="39" rx="4.2" ry="2.6" fill="#F48CA0" opacity=".7"/>
  <ellipse cx="32" cy="41" rx="8.4" ry="6" fill="#F7A0B0"/><ellipse cx="29" cy="41.2" rx="1.6" ry="2.2" fill="#C9596E"/><ellipse cx="35" cy="41.2" rx="1.6" ry="2.2" fill="#C9596E"/>
  <path d="M27.5 49.5q4.5 4.2 9 0" stroke="#B5485A" stroke-width="2" fill="#E8798A" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M25.8 58.6l6.2-2.6 6.2 2.6-6.2 2.6z" fill="#3A2A22"/><circle cx="32" cy="58.6" r="1.4" fill="#E3B67A"/></g></svg>`;
  }
  // A tiny oink (Web Audio), only after a tap, never on load.
  let ac; function oink() { try { if (localStorage.getItem("encore.pipMuted") === "1") return; ac = ac || new (window.AudioContext || window.webkitAudioContext)(); const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(); o.type = "sawtooth"; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(150, t + .16); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.12, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .2); const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900; o.connect(f).connect(g).connect(ac.destination); o.start(t); o.stop(t + .22); } catch {} }

  // Attendee personas: who shows up, and how. Used on Discover (you) and in the app (your guests).
  const PERSONAS = {
    regular: { name: "The Regular", emoji: "🫶", color: "#E26D8E", line: "Comes back. Knows everyone's name by week three.", host: "Your backbone. Ask them to co-host." },
    early: { name: "The Early Bird", emoji: "🐣", color: "#E0A030", line: "Says yes first, shows up first, helps set up.", host: "Invite them a day early. Their yes pulls others in." },
    connector: { name: "The Connector", emoji: "🔗", color: "#5B7FD6", line: "Never comes alone. Brings the friend who needed this.", host: "Give them two extra spots. They fill them." },
    contributor: { name: "The Contributor", emoji: "🧺", color: "#3E9C6E", line: "Brings snacks, a speaker, the folding table.", host: "Hand them a slot on the bring list." },
    explorer: { name: "The Explorer", emoji: "🧭", color: "#8C62C9", line: "Tries anything once. New neighborhood, new crowd.", host: "Your best bet for a first-timer event." },
  };
  const LANES = { move: ["run", "hike", "walk", "bike", "yoga", "swim", "climb", "sport"], make: ["bake", "giveaway", "cook", "craft", "paint", "garden", "pottery", "food"], gather: ["cafe", "dinner", "potluck", "brunch", "picnic", "games", "book", "movie", "wine", "tea"], discover: ["tour", "market", "museum", "music", "workshop", "talk", "new"] };
  const ACT_EMOJI = { run: "🏃", hike: "🥾", walk: "🚶", bike: "🚲", yoga: "🧘", giveaway: "🎁", bake: "🍰", cook: "🍳", craft: "✂️", cafe: "☕", cook: "🍽️", dinner: "🍽️", potluck: "🥘", brunch: "🥞", picnic: "🧺", games: "🎲", book: "📚", movie: "🎬", music: "🎶", market: "🛍️", swim: "🏊", garden: "🌱", tea: "🍵", wine: "🍷" };
  const actOf = (e) => { const a = String(e.activity || "").toLowerCase(); for (const k of Object.keys(ACT_EMOJI)) if (a.includes(k)) return k; const t = `${e.activity || ""} ${e.title || ""} ${(e.tags || []).join(" ")}`.toLowerCase(); for (const k of Object.keys(ACT_EMOJI)) if (t.includes(k)) return k; if (/cake|cookie|bread|mochi|pie/.test(t)) return "bake"; if (/coffee|café/.test(t)) return "cafe"; return e.activity || "gather"; };
  const laneOf = (e) => { const a = actOf(e); for (const [l, L] of Object.entries(LANES)) if (L.includes(a)) return l; return "gather"; };
  const fmtDate = (d) => { if (!d) return "Date TBA"; const x = new Date(d + "T12:00:00"); return isNaN(x) ? d : x.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); };
  function eventCard(e, why) {
    const a = actOf(e), em = e.emoji || e.host?.emoji || ACT_EMOJI[a] || "✨", free = e.free || !e.price;
    const ic = e.host?.cover ? `<img src="${esc(e.host.cover)}" alt="">` : e.host?.avatarArt && window.EncoreAvatars ? window.EncoreAvatars.svg(e.host.avatarArt, e.host.color, 46) : esc(em);
    const tm = e.startTime && /^\d{1,2}:\d{2}$/.test(e.startTime) ? new Date("2000-01-01T" + e.startTime.padStart(5, "0")).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : e.startTime;
    return `<a class="ev" href="/g#rsvp-${encodeURIComponent(e.id)}"><span class="ev-ic${e.host?.cover ? " photo" : ""}" style="--c:${esc(e.host?.color || "#E26D8E")}">${ic}</span><span class="ev-b"><b>${esc(e.title)}</b><small>${esc(fmtDate(e.date))}${tm ? " · " + esc(tm) : ""}${e.city ? " · " + esc(e.city) : ""}</small>${e.host ? `<small class="ev-h">by ${esc(e.host.name || "@" + e.host.handle)}</small>` : ""}${why ? `<small class="why">${esc(why)}</small>` : ""}</span><span class="ev-p ${free ? "free" : ""}">${free ? "Free" : esc(e.price)}</span></a>`;
  }
  function hostCard(h) {
    const ac = h.theme?.accent || h.color || "#E26D8E", av = (h.gallery || [])[0] ? `<img src="${esc(h.gallery[0])}" alt="">` : h.theme?.avatarArt && window.EncoreAvatars ? window.EncoreAvatars.svg(h.theme.avatarArt, ac, 48) : esc(h.emoji || "🎉");
    return `<a class="hc" href="/@${encodeURIComponent(h.handle)}" style="--c:${esc(ac)}"><span class="hc-av">${av}</span><b>${esc(h.name || "@" + h.handle)}</b><small>${esc([h.hood, h.city].filter(Boolean).join(", "))}</small><span class="hc-n">${h.followers || 0} follower${h.followers === 1 ? "" : "s"}${h.hosted ? ` · ${h.hosted} hosted` : ""}</span>${(h.tags || []).length ? `<span class="tags">${h.tags.slice(0, 3).map((t) => `<i>${esc(t)}</i>`).join("")}</span>` : ""}</a>`;
  }
  async function follow({ handle, email, name, tastes, via, eventId }) {
    let j; if (window.EncoreAccount) { j = await window.EncoreAccount.follow({ handle, email, name, tastes, via, eventId }, { hostName: arguments[0]?.hostName || "" }); if (!j) { const e = new Error(""); e.cancelled = true; throw e; } }
    else { const r = await fetch("/api/public/follow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle, email, name, tastes, via, eventId }) });
      j = await r.json().catch(() => ({})); if (r.status === 401) { location.href = "/signup?mode=friends&regularOf=" + encodeURIComponent(handle); return j; } if (!r.ok) throw new Error(j.message || "Couldn't follow. Try again."); }
    try { const L = JSON.parse(localStorage.getItem("encore.following") || "[]"); if (!L.includes(handle)) L.push(handle); localStorage.setItem("encore.following", JSON.stringify(L)); if (email) localStorage.setItem("encore.email", email); } catch {}
    return j;
  }
  window.EncoreCommunity = { esc, pipSVG, oink, PERSONAS, LANES, ACT_EMOJI, actOf, laneOf, fmtDate, eventCard, hostCard, follow };
})();
