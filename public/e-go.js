// /e/<id> share links: go straight to the RSVP page (the meta refresh is the fallback)
try { const m = location.pathname.match(/^\/e\/([A-Za-z0-9_-]+)$/); if (m) location.replace("/g#rsvp-" + encodeURIComponent(m[1])); } catch {}
