// Runs on every bundled page: picks the server first, then routes API calls.
import { naigiMobile } from "./mobile.js";
import { ensureApiBridge } from "./api-bridge.js";

const PICKER = "/picker.html";

if (!naigiMobile.hasServer() && !location.pathname.startsWith("/native/") && location.pathname !== PICKER) {
  location.replace(PICKER);
} else {
  // Only meaningful inside the app; in a browser preview there is no plugin and
  // the page keeps normal same-origin requests.
  naigiMobile.apiBridgeActive = false;
  void ensureApiBridge({
    fetch: globalThis.fetch.bind(globalThis),
    getPlugin: () => globalThis.Capacitor?.Plugins?.NaigiApi,
    getOrigin: () => naigiMobile.serverOrigin,
    appOrigin: location.origin,
  }).then((active) => {
    naigiMobile.apiBridgeActive = active;
  });
}
