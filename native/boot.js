// Runs on every bundled page: picks the server first, then routes API calls.
import { naigiMobile } from "./mobile.js";
import { installApiBridge } from "./api-bridge.js";

const PICKER = "/picker.html";

if (!naigiMobile.hasServer() && !location.pathname.startsWith("/native/") && location.pathname !== PICKER) {
  location.replace(PICKER);
} else {
  // Only meaningful inside the app; in a browser preview this is a no-op and the
  // page falls back to normal same-origin requests.
  installApiBridge({
    fetch: globalThis.fetch.bind(globalThis),
    plugin: globalThis.Capacitor?.Plugins?.NaigiApi,
    getOrigin: () => naigiMobile.serverOrigin,
    appOrigin: location.origin,
  });
}
