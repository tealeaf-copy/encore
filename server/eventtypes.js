// The event type tags (Pop-up, Pickup, House party, ...) on the server: the same file the browser runs
// (public/eventtypes.js), read once into a sandbox, so a card, an email and a link preview all say the same word.
// Cards carry the key as `etype`, and the browser's EventTypes.typeOf takes it as is.
import fs from "node:fs";
import vm from "node:vm";

const sandbox = {};
try { vm.runInNewContext(fs.readFileSync(new URL("../public/eventtypes.js", import.meta.url), "utf8"), sandbox); } catch {}
const T = sandbox.EventTypes || null;

/** The type key for an event, drop or booking ("event" when unsure). Pure. */
export const typeOf = (x) => { try { return T ? T.typeOf(x) : "event"; } catch { return "event"; } };
/** The type word ("Pop-up", "Pickup"). Pure. */
export const typeLabel = (x) => { try { return T ? T.labelOf(x) : "Event"; } catch { return "Event"; } };
/** The tint and text colour, as hex, for emails. Pure. */
export const typeColor = (x) => { const k = typeof x === "string" ? x : typeOf(x); return (T && T.COLOR[k]) || ["#EAE6DC", "#444845"]; };
export const TYPES = T ? [...T.TYPES] : ["event"];
export const EventTypes = T;
