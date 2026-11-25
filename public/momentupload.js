// ---- visual feed: adding photos and short videos from an event (moments) ----
// One uploader for the kudos thank-you screen, the host's After step and the feed's "Your story". It checks the type,
// size and length in the browser first (the server checks again), sends each file to POST /api/moments with the
// reply proof (rid and code) or the host's session, and for a video grabs a still frame and adds it as the poster.
(function () {
  const IMG = ["image/jpeg", "image/png", "image/webp", "image/gif"], VID = ["video/mp4", "video/webm", "video/quicktime"];
  let LIM = null;
  const limits = async () => LIM || (LIM = await fetch("/api/public/moment-limits").then((r) => r.json()).catch(() => ({ imageMB: 15, videoMB: 15, seconds: 15, perPick: 6 })));
  const typeOf = (f) => { const t = String(f.type || "").toLowerCase() || (/\.mov$/i.test(f.name) ? "video/quicktime" : /\.mp4$/i.test(f.name) ? "video/mp4" : ""); return IMG.includes(t) ? ["image", t] : VID.includes(t) ? ["video", t] : [null, t]; };
  // a video's length, size and a poster frame (a JPEG a little way in); WebM from some recorders reports Infinity until it's seeked
  function videoInfo(file) { return new Promise((res) => { const v = document.createElement("video"), url = URL.createObjectURL(file); let done = false; v.muted = true; v.playsInline = true; v.preload = "auto";
    const finish = (o) => { if (done) return; done = true; URL.revokeObjectURL(url); v.removeAttribute("src"); v.load(); res(o); }, t = setTimeout(() => finish({ seconds: 0, w: 0, h: 0, poster: null, playable: false }), 8000);
    v.onerror = () => { clearTimeout(t); finish({ seconds: 0, w: 0, h: 0, poster: null, playable: false }); };
    v.onloadedmetadata = () => { if (!isFinite(v.duration)) { v.currentTime = 1e7; v.ontimeupdate = () => { v.ontimeupdate = null; grab(); }; } else grab(); };
    const grab = () => { const seconds = isFinite(v.duration) ? v.duration : 0; v.onseeked = () => { try { const c = document.createElement("canvas"), k = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight, 1)); c.width = Math.round(v.videoWidth * k) || 540; c.height = Math.round(v.videoHeight * k) || 960; c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => { clearTimeout(t); finish({ seconds, w: v.videoWidth, h: v.videoHeight, poster: b, playable: true }); }, "image/jpeg", 0.82); } catch { clearTimeout(t); finish({ seconds, w: v.videoWidth, h: v.videoHeight, poster: null, playable: true }); } };
      v.currentTime = Math.min(0.4, seconds / 3 || 0.1); };
    v.src = url; }); }
  const imageSize = (file) => new Promise((res) => { const i = new Image(), u = URL.createObjectURL(file); i.onload = () => { res({ w: i.naturalWidth, h: i.naturalHeight }); URL.revokeObjectURL(u); }; i.onerror = () => { res({ w: 0, h: 0 }); URL.revokeObjectURL(u); }; i.src = u; });
  /** Check one file. Returns { ok, kind, type, why, info }. */
  async function check(file) { const L = await limits(), [kind, type] = typeOf(file);
    if (!kind) return { ok: false, why: `${file.name || "That file"} isn't a photo or a short video.` };
    const max = (kind === "video" ? L.videoMB : L.imageMB) * 1048576; if (file.size > max) return { ok: false, why: `${file.name || "That file"} is over ${kind === "video" ? L.videoMB : L.imageMB} MB.` };
    if (kind === "video") { const info = await videoInfo(file); if (info.seconds > L.seconds + 0.6) return { ok: false, why: `Videos can be up to ${L.seconds} seconds. Trim it and try again.` }; return { ok: true, kind, type, info }; }
    return { ok: true, kind, type, info: await imageSize(file) }; }
  /** Upload one file as a moment. q: { eventId, rid?, code?, caption? }. Returns the server's { id, url, type }. */
  async function upload(file, q, checked) { const c = checked || (await check(file)); if (!c.ok) throw new Error(c.why);
    const p = new URLSearchParams({ ...q }); if (c.info?.w && c.info?.h) { p.set("w", c.info.w); p.set("h", c.info.h); } if (c.info?.seconds) p.set("duration", c.info.seconds.toFixed(1));
    const r = await fetch("/api/moments?" + p, { method: "POST", headers: { "Content-Type": c.type }, body: file }), j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "That didn't upload. Try again.");
    if (c.kind === "video" && c.info?.poster && j.id) { const pq = new URLSearchParams({ eventId: q.eventId, ...(q.rid ? { rid: q.rid, code: q.code } : {}) }); await fetch(`/api/moments/${encodeURIComponent(j.id)}/poster?${pq}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: c.info.poster }).catch(() => {}); }
    return j; }
  /** Pick up to `max` files and upload them one by one. onEach(file, result|null, error|null, i, n). */
  function pick({ q, max, accept, onStart, onEach, onDone }) { const f = document.createElement("input"); f.type = "file"; f.multiple = true; f.accept = accept || "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.mov";
    f.onchange = async () => { const L = await limits(), all = [...(f.files || [])], files = all.slice(0, max || L.perPick || 6); if (!files.length) return; onStart?.(files, all.length - files.length); let n = 0;
      for (const [i, file] of files.entries()) { try { const r = await upload(file, q); n++; onEach?.(file, r, null, i, files.length); } catch (e) { onEach?.(file, null, e, i, files.length); } }
      onDone?.(n, files.length); };
    f.click(); }
  window.MomentUpload = { check, upload, pick, limits, IMG, VID };
})();
// ---- end visual feed ----
