// Shared bits for the public community pages (Discover and host pages): Potto, attendee personas, event cards.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function pipSVG(mood = "happy", size = 36) {
    if (window.Potto) return window.Potto.svg({ happy: "wave", think: "think", side: "think", cheer: "cheer", sleep: "sleep" }[mood] || "wave", Math.round(size * 1.15), "Potto");
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
    early: { name: "The Early Bird", emoji: "🐣", color: "#E0A030", line: "Replies first, shows up first, helps set up.", host: "Invite them a day early. Their yes pulls others in." },
    connector: { name: "The Connector", emoji: "🔗", color: "#5B7FD6", line: "Never comes alone. Brings the friend who needed this.", host: "Give them two extra spots. They fill them." },
    contributor: { name: "The Contributor", emoji: "🧺", color: "#3E9C6E", line: "Brings snacks, a speaker, the folding table.", host: "Hand them a slot on the bring list." },
    explorer: { name: "The Explorer", emoji: "🧭", color: "#8C62C9", line: "Tries anything once. New neighborhood, new crowd.", host: "Your best bet for a first-timer event." },
  };
  const LANES = { move: ["run", "hike", "walk", "bike", "yoga", "swim", "climb", "sport"], make: ["bake", "giveaway", "cook", "craft", "paint", "garden", "pottery", "food"], gather: ["cafe", "dinner", "potluck", "brunch", "picnic", "games", "book", "movie", "wine", "tea"], discover: ["tour", "market", "museum", "music", "workshop", "talk", "new"] };
  const ACT_EMOJI = { run: "🏃", hike: "🥾", walk: "🚶", bike: "🚲", yoga: "🧘", giveaway: "🎁", bake: "🍰", cook: "🍳", craft: "✂️", cafe: "☕", cook: "🍽️", dinner: "🍽️", potluck: "🥘", brunch: "🥞", picnic: "🧺", games: "🎲", book: "📚", movie: "🎬", music: "🎶", market: "🛍️", swim: "🏊", garden: "🌱", tea: "🍵", wine: "🍷" };
  const actOf = (e) => { const a = String(e.activity || "").toLowerCase(); for (const k of Object.keys(ACT_EMOJI)) if (a.includes(k)) return k; const t = `${e.activity || ""} ${e.title || ""} ${(e.tags || []).join(" ")}`.toLowerCase(); for (const k of Object.keys(ACT_EMOJI)) if (t.includes(k)) return k; if (/\b(\d+k|marathon|trot|jog|race|relay)\b/.test(t)) return "run"; if (/cake|cookie|bread|mochi|pie/.test(t)) return "bake"; for (const [k, em] of Object.entries(ACT_EMOJI)) if (e.emoji && e.emoji === em) return k; if (/coffee|café/.test(t)) return "cafe"; return e.activity || "gather"; };
  const laneOf = (e) => { const a = actOf(e); for (const [l, L] of Object.entries(LANES)) if (L.includes(a)) return l; return "gather"; };
  const fmtDate = (d) => { if (!d) return "Date TBA"; const x = new Date(d + "T12:00:00"); return isNaN(x) ? d : x.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); };
  // Event preview: a poster on top (cover photo, or a bright poster with the title and the host's sketch),
  // then the date as the headline, the faces of who's going, and one quiet line.
  const KW = [["taco","🌮"],["dumpling","🥟"],["pizza","🍕"],["sushi","🍣"],["omakase","🍣"],["ramen","🍜"],["brunch","🥞"],["bbq","🍖"],["wine","🍷"],["cocktail","🍸"],["coffee","☕"],["pour-over","☕"],["café","☕"],["hike","🥾"],["run","🏃"],["5k","🏃"],["bike","🚲"],["picnic","🧺"],["board game","🎲"],["game","🎲"],["movie","🎬"],["film","🎬"],["karaoke","🎤"],["book","📚"],["yoga","🧘"],["swim","🏊"],["beach","🏖️"],["cake","🍰"],["bake","🧁"],["cook","🍳"],["dinner","🍽️"],["supper","🍽️"]];
  const titleEmoji = (e) => { const t = `${e.title || ""} ${e.activity || ""}`.toLowerCase(); return (KW.find(([k]) => t.includes(k)) || [])[1] || ""; };
  const THEME_BG = { picnic: "#FFCAD6", disco: "#DCCBFF", sunny: "#F3E7A8", ocean: "#C4DEFF", linen: "#FFE3B8", candlelight: "#FFD9B0", gallery: "#E3F1DD", midnight: "#DCCBFF", sticker: "#F3E7A8" };
  const LANE_BG = { move: "#C4DEFF", make: "#FFCAD6", gather: "#F3E7A8", discover: "#DCCBFF" };
  // opts.compact: a shorter card for long lists (Discover): a low art band, the date and who's going on one line.
  function eventCard(e, why, opts) {
    const compact = !!(opts && opts.compact);
    const a = actOf(e), em = titleEmoji(e) || ACT_EMOJI[a] || (e.emoji !== "🎉" && e.emoji) || "🎉", free = e.free || !e.price, H = e.host || {};
    const sketch = (art, color, size) => (art && window.EncoreAvatars ? window.EncoreAvatars.svg(art, color || "#E26D8E", size) : "");
    const hostAv = H.cover ? `<img src="${esc(H.cover)}" alt="">` : sketch(H.avatarArt, H.color, 40) || esc(H.emoji || "🎉");
    const tm = e.startTime && /^\d{1,2}:\d{2}$/.test(e.startTime) ? new Date("2000-01-01T" + e.startTime.padStart(5, "0")).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/:00(?=\s)/, "").replace(/\s([AP]M)$/, (_, x) => x.toLowerCase()) : e.startTime;
    const when = e.date ? `${fmtDate(e.date)}${tm ? " · " + tm : ""}` : "Date coming soon";
    const epN = Number.isInteger(e.episode) && e.episode > 0 ? `<span class="ev-ep" style="font:500 .9em var(--sys-mono,ui-monospace,monospace);margin-left:6px;opacity:.8">#${e.episode}</span>` : ""; // review round 13: the episode in its series
    const drawn = !e.coverPhoto && window.EventArt, art = e.coverPhoto ? `<img class="ev-photo" src="${esc(e.coverPhoto)}" alt="">` : drawn ? window.EventArt.cover(e) : `<span class="ev-em" aria-hidden="true">${esc(em)}</span>`;
    const going = Math.max(0, +e.going || +e.goingCount || 0), faces = (e.faces || []).slice(0, 3);
    const stack = `<span class="ev-faces"><span class="ev-face host" style="--c:${esc(H.color || "#E26D8E")}">${hostAv}</span>${faces.map((f) => `<span class="ev-face" style="--c:${esc(f.color || "#F3E7A8")}">${f.art ? sketch(f.art, f.color, 40) : esc(f.emoji || "🙂")}</span>`).join("")}${going > faces.length ? `<span class="ev-face more">+${going - faces.length}</span>` : ""}</span>`;
    const quiet = [e.sample ? "Example" : "", e.city, free ? (e.costNote || "Free") /* review round 7: "About $40 food cost", not "Free" */ : e.price === "chip" ? "Chip in" : e.price, e.approvalRequired && !e.you ? "Ask to join" : "" /* never on the host's own (e.you: server/pageitems.js hostRole) */].filter(Boolean).map(esc).join(" · "); const crowdLine = e.crowd ? `<small class="ev-crowd" style="display:block;font-weight:600;color:var(--pl-soft);margin-top:2px">${esc(e.crowd.charAt(0).toUpperCase() + e.crowd.slice(1))}</small>` : "";
    if (compact) return `<a class="ev ev-poster ev-compact" href="/g#rsvp-${encodeURIComponent(e.id)}" style="--bg:${THEME_BG[e.theme] || LANE_BG[laneOf(e)] || "#F3E7A8"}">
      <span class="ev-art${e.coverPhoto ? " has-photo" : drawn ? " has-photo ea-card" : ""}">${art}${e.coverPhoto || drawn ? "" : `<b class="ev-title">${esc(e.title)}</b>`}${H.name ? `<span class="ev-by"><span class="ev-by-av">${hostAv}</span>${esc(H.name)}</span>` : ""}${e.sample ? `<span class="ev-sample" style="position:absolute;top:8px;left:8px;z-index:2;background:#fff;color:var(--pl-ink);border:1.5px solid var(--pl-ink);border-radius:999px;padding:1px 8px;font-size:12px;font-weight:700">Example</span>` : ""}</span>
      <span class="ev-b">${window.EventTypes ? window.EventTypes.tag(e, { cls: "pl-type--b" }) : ""}<span class="ev-hl"><b class="ev-when">${esc(when)}${epN}</b>${stack}</span>${e.coverPhoto ? `<span class="ev-t2">${esc(e.title)}</span>` : ""}<small class="ev-q">${quiet.replace(/^Example( · )?/, "")}</small>${why ? `<small class="why">${esc(why)}</small>` : ""}</span></a>`;
    return `<a class="ev ev-poster" href="/g#rsvp-${encodeURIComponent(e.id)}" style="--bg:${THEME_BG[e.theme] || LANE_BG[laneOf(e)] || "#F3E7A8"}">
      <span class="ev-art${e.coverPhoto ? " has-photo" : drawn ? " has-photo ea-card" : ""}">${art}${e.coverPhoto || drawn ? "" : `<b class="ev-title">${esc(e.title)}</b>`}${H.name ? `<span class="ev-by"><span class="ev-by-av">${hostAv}</span>${esc(H.name)}</span>` : ""}</span>
      <span class="ev-b">${window.EventTypes ? window.EventTypes.tag(e, { cls: "pl-type--b" }) : ""}<b class="ev-when">${esc(when)}${epN}</b>${e.coverPhoto ? `<span class="ev-t2">${esc(e.title)}</span>` : ""}${stack}${crowdLine}<small class="ev-q">${quiet}</small>${why ? `<small class="why">${esc(why)}</small>` : ""}</span></a>`;
  }
  function hostCard(h) {
    const ac = h.theme?.accent || h.color || "#E26D8E", av = (h.gallery || [])[0] ? `<img src="${esc(h.gallery[0])}" alt="">` : h.theme?.avatarArt && window.EncoreAvatars ? window.EncoreAvatars.svg(h.theme.avatarArt, ac, 48) : esc(h.emoji || "🎉");
    return `<a class="hc" href="/@${encodeURIComponent(h.handle)}" style="--c:${esc(ac)}"><span class="hc-av">${av}</span><b>${esc(h.name || "@" + h.handle)}</b><small>${esc([h.hood, h.city].filter(Boolean).join(", "))}</small>${h.sample ? `<span class="hc-ex">Example</span>` : ""}${h.rising ? `<span class="rising">🌱 Rising in ${esc(h.rising.city)}</span>` : ""}${h.next ? `<span class="hc-nx" style="display:block;font-weight:600;color:var(--pl-ink);margin:4px 0 2px">Next: ${esc(h.next)}</span>` : ""}${h.followers || h.hosted ? `<span class="hc-n">${[h.followers ? `${h.followers} follower${h.followers === 1 ? "" : "s"}` : "", h.hosted ? `${h.hosted} event${h.hosted === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}</span>` : ""}${(h.tags || []).length ? `<span class="tags">${h.tags.slice(0, 3).map((t) => `<i>${esc(t)}</i>`).join("")}</span>` : ""}</a>`;
  }
  async function follow({ handle, email, name, tastes, via, eventId }) {
    let j; if (window.EncoreAccount) { j = await window.EncoreAccount.follow({ handle, email, name, tastes, via, eventId }, { hostName: arguments[0]?.hostName || "", first: arguments[0]?.first || "" }); if (!j) { const e = new Error(""); e.cancelled = true; throw e; } }
    else { const r = await fetch("/api/public/follow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle, email, name, tastes, via, eventId }) });
      j = await r.json().catch(() => ({})); if (r.status === 401) { location.href = "/signup?mode=friends&regularOf=" + encodeURIComponent(handle); return j; } if (!r.ok) throw new Error(j.message || "Couldn't follow. Try again."); }
    try { const L = JSON.parse(localStorage.getItem("encore.following") || "[]"); if (!L.includes(handle)) L.push(handle); localStorage.setItem("encore.following", JSON.stringify(L)); if (email) localStorage.setItem("encore.email", email); } catch {}
    return j;
  }
  window.EncoreCommunity = { esc, pipSVG, oink, PERSONAS, LANES, ACT_EMOJI, actOf, laneOf, fmtDate, eventCard, hostCard, follow };
})();
