// Fills mobile/www, the little the app bundle carries: the offline screen (server.errorPath) and what it needs.
// Everything else loads from the live site. Run by `npm run www` (and `npm run sync`).
const fs = require("fs"), path = require("path");
const pub = path.join(__dirname, "..", "..", "public"), www = path.join(__dirname, "..", "www");
fs.mkdirSync(www, { recursive: true });
for (const f of ["offline.html", "mascot.js", "favicon.svg"]) fs.copyFileSync(path.join(pub, f), path.join(www, f));
// the bundled offline screen can't reach /api/me/plans (it isn't on the site's origin), so it skips the plans list
let off = fs.readFileSync(path.join(www, "offline.html"), "utf8").replace('src="/mascot.js"', 'src="mascot.js"').replace('href="/favicon.svg"', 'href="favicon.svg"');
const origin = process.env.POTTERYLAB_ORIGIN || "https://potterylab.ai";
off = off.replace("location.reload()", `location.href = ${JSON.stringify(origin + "/feed?source=app")}`).replace('addEventListener("online", () => location.reload());', "");
fs.writeFileSync(path.join(www, "offline.html"), off);
// Capacitor wants an index.html in webDir; the app opens server.url, so this only shows if that fails
fs.writeFileSync(path.join(www, "index.html"), off);
console.log("mobile/www ready:", fs.readdirSync(www).join(", "));
