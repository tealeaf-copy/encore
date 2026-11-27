// "Start from your Instagram" in the browser (server/igimport.js, docs/instagram-import.md).
// IgImport.page(): the /import/instagram page: the choice, the handle, bio and photos, "Potto is reading your posts…",
//   the review where every field says where it came from, and "Looks good, save my page".
// IgImport.settingsRow(el): the "Import from Instagram" row in the page editor (public/storefront.js).
// On a host's own page (public/host.html): after claiming a prepared page (?welcome=1), a card offers
//   "Refresh from your Instagram"; after a save (?imported=1), a short note.
// Photos stay in this tab. They go to the server only for the draft (not stored there), and the ones picked for the
// page are uploaded when the person taps "Looks good, save my page".
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r = document) => r.querySelector(s);
  const j = async (url, opt = {}) => { const r = await fetch(url, { credentials: "same-origin", ...opt, headers: { ...(opt.body && typeof opt.body === "string" ? { "content-type": "application/json" } : {}), ...(opt.headers || {}) } }); const b = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(b.message || "That didn't work. Try again."), { code: b.code, status: r.status }); return b; };
  const safeNext = (v) => (/^\/(?!\/)[^\s]*$/.test(String(v || "")) ? String(v) : "");
  const handleOf = (s) => { s = String(s || "").trim(); const m = s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/([^/?#\s]+)\/?(?:[?#].*)?$/i); if (m) s = m[1]; s = s.replace(/^@/, "").toLowerCase(); return /^[a-z0-9._]{1,30}$/.test(s) && !/\.\./.test(s) && !/^\.|\.$/.test(s) ? s : ""; };

  // ---------- photos: shrink in the browser, read their colors ----------
  const MAXPX = 1280;
  function loadImg(src) { return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; }); }
  async function shrink(file) {
    const url = URL.createObjectURL(file), img = await loadImg(url), k = Math.min(1, MAXPX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k)); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    let q = 0.86, data = c.toDataURL("image/jpeg", q); while (data.length > 2.6e6 && q > 0.4) { q -= 0.12; data = c.toDataURL("image/jpeg", q); }
    const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", q)); return { data, blob, thumb: URL.createObjectURL(blob), w: c.width, h: c.height };
  }
  const hsl = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0; let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(h * 60 + 360) % 360, s, l]; };
  const hex = (r, g, b) => "#" + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("").toUpperCase();
  /** A brand palette from their photos: a strong accent, a second accent of another hue, a light page tone. */
  async function palette(srcs) {
    const B = new Map(), c = document.createElement("canvas"); c.width = c.height = 48; const x = c.getContext("2d", { willReadFrequently: true });
    for (const s of srcs.slice(0, 8)) { try { const img = await loadImg(s); x.clearRect(0, 0, 48, 48); x.drawImage(img, 0, 0, 48, 48); const d = x.getImageData(0, 0, 48, 48).data;
      for (let i = 0; i < d.length; i += 4) { const k = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | d[i + 2] >> 4, o = B.get(k) || { n: 0, r: 0, g: 0, b: 0 }; o.n++; o.r += d[i]; o.g += d[i + 1]; o.b += d[i + 2]; B.set(k, o); } } catch {} }
    const L = [...B.values()].map((o) => { const r = o.r / o.n, g = o.g / o.n, b = o.b / o.n, [h, s, l] = hsl(r, g, b); return { n: o.n, hex: hex(r, g, b), h, s, l }; });
    if (!L.length) return null;
    const strong = L.filter((o) => o.s > 0.28 && o.l > 0.2 && o.l < 0.62).sort((a, b) => b.n * b.s - a.n * a.s);
    const accent = strong[0] || L.filter((o) => o.l < 0.5).sort((a, b) => b.n - a.n)[0] || L[0];
    const far = (a, b) => Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h)) > 40;
    const accent2 = strong.find((o) => far(o, accent)) || strong[1] || null;
    const page = L.filter((o) => o.l > 0.82 && o.s < 0.35).sort((a, b) => b.n - a.n)[0];
    return { accent: accent.hex, accent2: accent2?.hex || "", page: page?.hex || "" };
  }

  // ---------- the page ----------
  async function page() {
    const q = new URLSearchParams(location.search), mode = q.get("mode") === "refresh" ? "refresh" : "new", next = safeNext(q.get("next"));
    const S = { mode, photos: [], draft: null, via: "", official: [], pal: null, cover: null, gallery: new Set(), avatar: null, offers: [], chips: {} };
    const show = (id) => { ["sChoice", "sSource", "sRead", "sReview"].forEach((k) => { $("#" + k).hidden = k !== id; }); $("#goBar").hidden = id !== "sReview"; window.scrollTo(0, 0); };
    let cfg = {}; try { cfg = await j("/api/igimport/config"); } catch {}
    const after = next || (cfg.host?.handle && mode === "refresh" ? "/@" + cfg.host.handle : "/feed?welcome=1");
    $("#skip").href = after; $("#goScratch").href = after;
    if (!cfg.signedIn) { $("#sChoice").hidden = false; $("#goIg").onclick = () => { location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search); }; $("#goScratch").href = "/signup?mode=friends"; $("#skip").href = "/signup?mode=friends"; return; }
    if (cfg.official) { $("#official").hidden = false; $("#connect").href = "/api/igimport/oauth/start?mode=" + mode; }
    if (cfg.imported) { $("#discWrap").hidden = false; $("#disc").onclick = async () => { try { const r = await j("/api/igimport/disconnect", { method: "POST", body: "{}" }); $("#discWrap").textContent = r.message; } catch (e) { $("#srcErr").textContent = e.message; } }; }
    if (mode === "refresh") { $("#srcEye").textContent = "Refresh from your Instagram"; $("#srcH").textContent = "Bring in your latest posts"; $("#srcLede").textContent = "Potto compares them with your page and shows you what's new. You pick what to use."; $("#read").textContent = "Read my latest posts"; }
    const hd = $("#handle"); const igLink = (cfg.host?.links || []).find((l) => /instagram\.com/i.test(l.url)); if (igLink) hd.value = "@" + handleOf(igLink.url);
    if (q.get("ig") === "denied") $("#srcErr").textContent = "Instagram didn't connect. You can use your photos instead.";
    if (q.get("ig") === "failed") $("#srcErr").textContent = "We couldn't read your Instagram just now. Use your photos instead, or try again.";

    // the official path came back with a draft waiting
    if (q.get("draft")) { show("sRead"); reading([["Reading your profile", true], ["Looking at your recent posts", true]]); try { const r = await j("/api/igimport/draft", { method: "POST", body: JSON.stringify({ draft: q.get("draft"), mode }) }); S.via = "official"; S.official = r.photos; await finish(r.draft, r.photos.map((p) => p.url)); } catch (e) { show("sSource"); $("#srcErr").textContent = e.message; } return; }
    if (mode === "new") { show("sChoice"); $("#goIg").onclick = () => show("sSource"); } else show("sSource");

    // photos in
    const drawThumbs = () => { $("#thumbs").innerHTML = S.photos.map((p, i) => `<div class="th"><img src="${p.thumb}" alt="Photo ${i + 1}"><button type="button" class="x" data-i="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`).join("");
      $("#count").textContent = S.photos.length ? `${S.photos.length} of 12 photos${S.photos.length < 3 ? `. Add ${3 - S.photos.length} more.` : ""}` : "";
      $("#thumbs").querySelectorAll(".x").forEach((b) => (b.onclick = () => { URL.revokeObjectURL(S.photos[+b.dataset.i].thumb); S.photos.splice(+b.dataset.i, 1); drawThumbs(); })); };
    $("#files").onchange = async (e) => { $("#srcErr").textContent = ""; const F = [...e.target.files]; e.target.value = "";
      for (const f of F) { if (S.photos.length >= 12) { $("#srcErr").textContent = "That's 12. Remove one to add another."; break; } if (!/^image\//.test(f.type)) { $("#srcErr").textContent = "That one isn't a photo."; continue; } if (f.size > 25e6) { $("#srcErr").textContent = "One photo is over 25 MB. Try a smaller one."; continue; }
        try { S.photos.push(await shrink(f)); } catch { $("#srcErr").textContent = "One photo couldn't be read. Try another."; } drawThumbs(); } };

    $("#read").onclick = async () => { const err = $("#srcErr"); err.textContent = ""; const h = hd.value.trim(), handle = handleOf(h);
      if (h && !handle) { err.textContent = "That doesn't look like an Instagram handle. Try @yourshop."; hd.focus(); return; }
      if (S.photos.length < 3 && !(S.photos.length === 0 && $("#bio").value.trim())) { err.textContent = S.photos.length ? `Add ${3 - S.photos.length} more photo${S.photos.length === 2 ? "" : "s"}, or remove them and use just your bio.` : "Paste your bio or pick 3 photos first."; return; }
      show("sRead"); const steps = [[handle ? `Looking at @${handle}` : "Starting your draft", true], [$("#bio").value.trim() ? "Reading your bio" : "", true], [S.photos.length ? `Looking at ${S.photos.length} photos` : "", true]].filter((s) => s[0]); reading(steps);
      try { const r = await j("/api/igimport/draft", { method: "POST", body: JSON.stringify({ handle, bio: $("#bio").value, extra: $("#extra").value, photos: S.photos.map((p) => ({ type: "image/jpeg", data: p.data })), mode }) });
        S.via = "photos"; await finish(r.draft, S.photos.map((p) => p.thumb)); }
      catch (e) { show("sSource"); err.textContent = e.message; } };

    // ---------- "Potto is reading your posts…": what it finds, line by line, calm and quick ----------
    let shown = 0, timer = null; const queue = [];
    function reading(lines) { $("#potto").innerHTML = window.Potto ? Potto.svg("think", 96, "Potto") : ""; $("#found").innerHTML = ""; shown = 0; queue.length = 0; lines.forEach((l) => queue.push(l[0])); tick(); }
    function tick() { clearTimeout(timer); if (shown >= queue.length) return; const li = document.createElement("li"); li.innerHTML = `<i aria-hidden="true"></i><span>${esc(queue[shown])}</span>`; $("#found").appendChild(li); requestAnimationFrame(() => li.classList.add("in"));
      const prev = $("#found").children[shown - 1]; if (prev) { prev.classList.add("done"); prev.querySelector("i").textContent = "✓"; } shown++; timer = setTimeout(tick, 520); }
    async function finish(d, srcs) {
      S.draft = d; (d.findings || []).forEach((f) => queue.push(f)); queue.push("Picking colors from your photos"); tick();
      const palP = srcs.length ? palette(srcs) : Promise.resolve(null);
      await new Promise((ok) => { const wait = () => (shown >= queue.length ? setTimeout(ok, 500) : setTimeout(wait, 120)); wait(); });
      [...$("#found").children].forEach((li) => { li.classList.add("done"); li.querySelector("i").textContent = "✓"; });
      S.pal = await palP; S.srcs = srcs; await new Promise((ok) => setTimeout(ok, 350)); review(); }

    // ---------- the review ----------
    function review() {
      const d = S.draft, H = cfg.host || {}, refresh = mode === "refresh";
      // a field is used unless they untick it; when refreshing, a field the page already has starts unticked
      const useDef = (now, v) => !refresh || !String(now || "").trim() || (!!v && String(v).trim() !== String(now).trim() ? false : true);
      const src = (f) => `<span class="src${f?.from ? "" : " none"}">${esc(f?.from || "not found, add it if you like")}</span>`;
      const tick = (k, on) => `<label class="use"><input type="checkbox" data-use="${k}" ${on ? "checked" : ""}>Use</label>`;
      const now = (v) => (refresh && String(v || "").trim() ? `<p class="now">Now: ${esc(v)}</p>` : "");
      const text = (k, label, f, nowV, area) => `<div class="fl"><div class="hd"><b>${label}</b>${tick(k, !!f?.value && useDef(nowV, f?.value))}</div>${src(f)}${area ? `<textarea data-f="${k}" rows="4">${esc(f?.value)}</textarea>` : `<input data-f="${k}" value="${esc(f?.value)}">`}${now(nowV)}</div>`;
      const chips = (k, label, f, extra) => { const L = [...new Set([...(f?.value || []), ...(extra || [])])]; S.chips[k] = new Set(f?.value || []); return `<div class="fl"><div class="hd"><b>${label}</b>${tick(k, true)}</div>${src(f)}<div class="chips" data-chips="${k}">${L.map((t) => `<button type="button" class="chip" data-v="${esc(t)}" aria-pressed="${S.chips[k].has(t)}">${esc(t)}</button>`).join("")}</div></div>`; };
      S.offers = (d.offerings || []).map((o) => ({ ...o }));
      const n = S.srcs.length; S.cover = d.cover; S.gallery = new Set(d.gallery || []); S.avatar = d.avatar?.photo ? d.avatar.photo : "art";
      const thumbs = (k, sel, multi) => `<div class="ph" data-ph="${k}">${S.srcs.map((s, i) => `<button type="button" data-n="${i + 1}" aria-pressed="${multi ? sel.has(i + 1) : sel === i + 1}" aria-label="Photo ${i + 1}"><img src="${esc(s)}" alt=""><small>${i + 1}</small></button>`).join("")}${k === "avatar" && window.EncoreAvatars ? `<button type="button" class="art" data-n="art" aria-pressed="${S.avatar === "art"}" aria-label="A drawn face">${EncoreAvatars.svg(d.avatar?.art || "barista", S.pal?.accent || "#29489A", 72)}<small>drawn</small></button>` : ""}</div>`;
      $("#review").innerHTML = `
        <h2>About you</h2><div class="card">
          ${text("name", "Name", d.name, H.name)}
          <div class="fl"><div class="hd"><b>Instagram</b>${tick("handle", true)}</div><span class="src">${d.handle ? "linked on your page" : "add your handle to link it"}</span><input data-f="handle" value="${d.handle ? "@" + esc(d.handle) : ""}" placeholder="@yourshop" autocapitalize="none"></div>
          ${text("tagline", "Tagline", d.tagline, H.tagline)}
          ${text("about", "About", d.about, H.bio, true)}
          <div class="two">${text("hood", "Neighbourhood", d.hood, H.hood)}${text("city", "City", d.city, H.city)}</div>
          ${text("hours", "Opening hours", d.hours, "")}
          ${text("website", "Website", d.website, "")}
        </div>
        <h2>What you do</h2><div class="card">
          ${chips("tags", "Tags", d.tags)}
          ${chips("events", "Events you could host", d.events, ["Tastings", "Workshops", "Pop-ups"])}
          ${chips("brandEvents", "For brands", d.brandEvents, ["Catering", "Office coffee pop-ups"])}
        </div>
        <h2>What you make</h2><div class="card"><div class="fl"><div class="hd"><b>Menu and offerings</b>${tick("offerings", true)}</div><span class="src none">Prices only when you said them. Add or change any.</span></div><div id="offers"></div><button type="button" class="btn sm" id="addOffer">Add one</button>${H.shopOpen ? `<p class="fine">Your shop is open, so only ones with a price are added to it.</p>` : `<p class="fine">Saved as your menu in a closed shop. Open it when you're ready.</p>`}</div>
        ${n ? `<h2>Photos</h2><div class="card">
          <div class="fl"><div class="hd"><b>Cover</b>${tick("cover", true)}</div><span class="src">from the photos you gave</span>${thumbs("cover", S.cover)}</div>
          <div class="fl"><div class="hd"><b>Gallery</b>${tick("gallery", true)}</div><span class="src">tap to add or take out</span>${thumbs("gallery", S.gallery, true)}</div>
          <div class="fl"><div class="hd"><b>Profile picture</b>${tick("avatar", !refresh)}</div><span class="src">${S.via === "official" && d.avatar?.photo ? "from your Instagram profile" : "one of your photos, or a drawn one"}</span>${thumbs("avatar", S.avatar)}</div>
          <p class="fine">Photos you don't pick are not kept.</p></div>` : ""}
        ${S.pal ? `<h2>Your colors</h2><div class="card"><div class="fl"><div class="hd"><b>Brand kit</b>${tick("palette", !refresh)}</div><span class="src">from the colors in your photos</span><div class="sw"><label><input type="color" data-pal="accent" value="${S.pal.accent}">Main</label>${S.pal.accent2 ? `<label><input type="color" data-pal="accent2" value="${S.pal.accent2}">Second</label>` : ""}${S.pal.page ? `<label><input type="color" data-pal="page" value="${S.pal.page}">Page</label>` : ""}</div><p class="fine">They go in your brand kit, for your page, events and invites. Text stays easy to read.</p></div></div>` : ""}`;
      drawOffers();
      $("#review").querySelectorAll("[data-chips]").forEach((g) => g.addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; const set = S.chips[g.dataset.chips], v = b.dataset.v; if (set.has(v)) set.delete(v); else set.add(v); b.setAttribute("aria-pressed", String(set.has(v))); }));
      $("#review").querySelectorAll("[data-ph]").forEach((g) => g.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const k = g.dataset.ph, v = b.dataset.n === "art" ? "art" : +b.dataset.n;
        if (k === "gallery") { if (S.gallery.has(v)) S.gallery.delete(v); else S.gallery.add(v); } else S[k] = v;
        g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(k === "gallery" ? S.gallery.has(+x.dataset.n) : String(S[k]) === x.dataset.n))); }));
      $("#review").querySelectorAll("[data-pal]").forEach((x) => (x.oninput = () => { S.pal[x.dataset.pal] = x.value.toUpperCase(); }));
      $("#addOffer").onclick = () => { S.offers.push({ name: "", price: "", priceLabel: "price not set", from: "added by you" }); drawOffers(); const L = $("#offers").querySelectorAll("[data-on]"); L[L.length - 1]?.focus(); };
      show("sReview"); $("#revEye").textContent = refresh ? "What's new on your Instagram" : "Your draft"; $("#revH").textContent = refresh ? "Here's what's new" : "Here's your page, drafted";
    }
    function drawOffers() { $("#offers").innerHTML = S.offers.map((o, i) => `<div class="offer"><input data-on="${i}" value="${esc(o.name)}" aria-label="Name" placeholder="Pandan latte"><input data-op="${i}" value="${esc(o.price)}" aria-label="Price" placeholder="price not set" inputmode="decimal"><button type="button" class="x" data-ox="${i}" aria-label="Remove ${esc(o.name || "this one")}">×</button><p class="offer-src${o.priceCheck ? " chk" : ""}">${esc([o.from, o.price ? (o.priceCheck ? "price read from your photo, check it" : "") : "price not set"].filter(Boolean).join(" · "))}</p></div>`).join("") || `<p class="fine" style="margin:0 0 10px">Potto didn't find a menu. Add what you make if you like.</p>`;
      $("#offers").querySelectorAll("[data-on]").forEach((x) => (x.oninput = () => { S.offers[+x.dataset.on].name = x.value; }));
      $("#offers").querySelectorAll("[data-op]").forEach((x) => (x.oninput = () => { S.offers[+x.dataset.op].price = x.value.trim() && !/^\$/.test(x.value.trim()) ? "$" + x.value.trim() : x.value.trim(); }));
      $("#offers").querySelectorAll("[data-ox]").forEach((x) => (x.onclick = () => { S.offers.splice(+x.dataset.ox, 1); drawOffers(); })); }

    // ---------- "Looks good, save my page" ----------
    $("#save").onclick = async () => { const b = $("#save"), err = $("#saveErr"); err.textContent = ""; b.disabled = true; b.textContent = "Saving your page…";
      try { const R = $("#review"), val = (k) => R.querySelector(`[data-f="${k}"]`)?.value || "", use = {}; R.querySelectorAll("[data-use]").forEach((c) => { use[c.dataset.use] = c.checked; });
        const fields = { name: val("name"), handle: handleOf(val("handle")), tagline: val("tagline"), about: val("about"), hood: val("hood"), city: val("city"), hours: val("hours"), website: val("website"),
          tags: [...(S.chips.tags || [])], events: [...(S.chips.events || [])], brandEvents: [...(S.chips.brandEvents || [])], offerings: S.offers.filter((o) => o.name.trim()).map((o) => ({ name: o.name, price: o.price })) };
        // photos: the official path sends numbers (the server stores those); the photo path uploads only the picked ones now
        const picked = [...new Set([use.cover !== false && S.cover, ...(use.gallery !== false ? [...S.gallery] : []), use.avatar !== false && S.avatar !== "art" && S.avatar].filter((x) => Number.isInteger(x)))], url = {};
        if (S.via === "photos") for (const n of picked) { const r = await fetch("/api/assets", { method: "POST", credentials: "same-origin", headers: { "content-type": "image/jpeg" }, body: S.photos[n - 1].blob }); const k = await r.json().catch(() => ({})); if (!r.ok) throw new Error(k.message || "A photo didn't upload. Try again."); url[n] = k.url; }
        const ref = (n) => (S.via === "official" ? { media: n } : url[n]);
        const photos = { cover: Number.isInteger(S.cover) ? ref(S.cover) : null, gallery: [...S.gallery].map(ref), avatar: S.avatar === "art" ? "art" : Number.isInteger(S.avatar) ? ref(S.avatar) : null, art: S.draft.avatar?.art || "" };
        const r = await j("/api/igimport/save", { method: "POST", body: JSON.stringify({ mode, fields, use, photos, palette: S.pal || {}, ...(S.via === "official" ? { draft: q.get("draft") } : {}) }) });
        S.photos.forEach((p) => URL.revokeObjectURL(p.thumb)); S.photos = []; // nothing else is kept
        location.href = "/@" + r.handle + "?imported=1"; }
      catch (e) { err.textContent = e.message; b.disabled = false; b.textContent = "Looks good, save my page"; } };
  }

  // ---------- page settings: "Import from Instagram" (the page editor calls this) ----------
  function settingsRow(el) { if (!el || el.dataset.ig) return; el.dataset.ig = "1"; const h = location.pathname.replace(/^\/@/, "").split("/")[0];
    el.innerHTML = `<div class="bk-entry"><span><b>Import from Instagram</b><small>Refresh your page from your latest posts</small></span><a href="/import/instagram?mode=refresh&next=${encodeURIComponent("/@" + h)}" class="ig-open" style="display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border:1.5px solid var(--pl-ink);border-radius:6px;color:var(--pl-ink);text-decoration:none;font-weight:600">Open</a></div>`; }

  // ---------- on the host's own page: after a claim, and after a save ----------
  function hostPage() { const q = new URLSearchParams(location.search), m = /^\/@([a-z0-9-]+)$/.exec(location.pathname); if (!m || !(q.get("welcome") || q.get("imported"))) return; let tries = 0;
    const go = () => { if (!document.body.classList.contains("is-owner")) { if (tries++ < 20) setTimeout(go, 300); return; } if (document.getElementById("igCard")) return;
      const c = document.createElement("div"); c.id = "igCard"; c.setAttribute("role", "status");
      c.style.cssText = "position:fixed;left:16px;right:16px;bottom:calc(84px + env(safe-area-inset-bottom));max-width:440px;margin:0 auto;z-index:40;background:var(--pl-surface);color:var(--pl-ink);border:1.5px solid var(--pl-ink);border-radius:6px;padding:14px 16px;font:15px/1.45 var(--pl-font-text);box-shadow:var(--pl-shadow-float,0 8px 24px rgba(0,0,0,.18))";
      const close = `<button type="button" data-x aria-label="Close" style="position:absolute;top:6px;right:6px;width:36px;height:36px;border:0;background:none;font-size:18px;cursor:pointer;color:var(--pl-ink)">×</button>`;
      if (q.get("imported")) c.innerHTML = `${close}<b style="display:block;font-size:16px">Your page is saved</b>This is how people see it. Change anything with Edit page.`;
      else c.innerHTML = `${close}<b style="display:block;font-size:16px;padding-right:28px">This page is yours now</b><span>Bring in your latest posts, hours and photos. You check everything first.</span><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><a href="/import/instagram?mode=refresh&next=${encodeURIComponent(location.pathname)}" style="display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:6px;background:var(--pl-accent);color:var(--pl-on-accent);text-decoration:none;font-weight:600">Refresh from your Instagram</a><button type="button" data-x style="min-height:44px;padding:0 14px;border-radius:6px;border:1.5px solid var(--pl-ink);background:var(--pl-surface);color:var(--pl-ink);font:600 15px var(--pl-font-text);cursor:pointer">Not now</button></div>`;
      document.body.appendChild(c); c.querySelectorAll("[data-x]").forEach((b) => (b.onclick = () => c.remove())); if (q.get("imported")) setTimeout(() => c.remove(), 7000); };
    go(); }

  window.IgImport = { page, settingsRow, palette, handleOf };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hostPage); else hostPage();
})();
