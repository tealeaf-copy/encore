// The marketer demo's sandbox (server/branddemo.js): while a request comes from a demo brand workspace, everything it
// sets off runs inside demoCtx. Email, texts and pushes check it and send nothing; team bookings made in the demo are
// seen only by that demo workspace (server/brandbook.js reqs()), so no metric, sweep or other brand ever counts them.
import { AsyncLocalStorage } from "node:async_hooks";

export const demoCtx = new AsyncLocalStorage();
/** The demo workspace this request runs for, or "". */
export const demoWsNow = () => demoCtx.getStore()?.ws || "";
export const inDemo = () => !!demoWsNow();
/** Demo and example people live at @demo.encore: never mailed, texted or pushed. */
export const isDemoEmail = (e) => /@demo\.encore$/i.test(String(e || "").trim());
