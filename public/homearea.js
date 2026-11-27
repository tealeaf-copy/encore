// Settings: "Home area", a neighbourhood or two cross streets Potto uses to suggest places near you when you make an
// event (public/placesuggest.js, server/placesuggest.js /api/me/home-area). Private: only you see it, guests never do.
// "Somewhere in the middle" is a second, separate choice, off until you turn it on.
(function () {
  const box = document.getElementById("plHomeSet"); if (!box) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const call = async (method, body) => { const r = await fetch("/api/me/home-area", { method, credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "That didn't work. Try again."); return j; };
  call("GET").then((h) => {
    box.hidden = false;
    box.innerHTML = `<h2 id="hHome">Home area</h2><p>Potto suggests places near here when you make an event, like a café for a coffee. A neighbourhood or two cross streets is plenty. Only you see it.</p>
      <form id="haForm" class="ha" novalidate>
        <label class="ha-f">Neighbourhood or cross streets<input id="haArea" maxlength="80" autocomplete="off" placeholder="Greenpoint, or Franklin St and Nassau Ave" value="${esc(h.area)}"></label>
        <label class="ha-f">City<input id="haCity" maxlength="60" autocomplete="address-level2" value="${esc(h.city)}"></label>
        <div class="row"><span>Somewhere in the middle<small>When a friend plans something with you, Potto can suggest a spot between your areas. They never see your area, only the spot.</small></span><input type="checkbox" class="sw" id="haShare" aria-label="Somewhere in the middle"${h.share ? " checked" : ""}></div>
        <div class="ha-b"><button type="submit" class="btn" id="haSave">Save home area</button><button type="button" class="btn" id="haDel"${h.set ? "" : " hidden"}>Remove</button></div>
        <p class="msg" id="haMsg" role="status"></p></form>`;
    const $ = (s) => box.querySelector(s), msg = (t) => ($("#haMsg").textContent = t);
    $("#haForm").onsubmit = async (e) => { e.preventDefault(); $("#haSave").disabled = true; msg("Saving…");
      try { const j = await call("POST", { area: $("#haArea").value, city: $("#haCity").value, share: $("#haShare").checked }); $("#haDel").hidden = false; msg(j.found ? "Saved. Only you can see it." : "Saved. I couldn't place that exact area, so I'll use the middle of the city for now."); }
      catch (err) { msg(err.message); } finally { $("#haSave").disabled = false; } };
    $("#haShare").onchange = () => { if ($("#haArea").value.trim().length >= 2) $("#haForm").requestSubmit(); };
    $("#haDel").onclick = async () => { try { await call("DELETE"); $("#haArea").value = ""; $("#haShare").checked = false; $("#haDel").hidden = true; msg("Removed."); } catch (err) { msg(err.message); } };
  }).catch(() => {});
})();
