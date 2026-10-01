// Native bridge exposed to the bundled Naigi pages inside the app shell.
import { createServerStore, verifyServer, MAX_SERVERS } from "./servers.js";
import { permissions, PERMISSIONS } from "./permissions.js";

const build = globalThis.__NAIGI_MOBILE_BUILD__ ?? null;
const store = createServerStore(window.localStorage, {
  // Mirror the choice where the native request proxy can read it.
  onChange: (state) => {
    void globalThis.Capacitor?.Plugins?.NaigiServer?.setServers?.({
      servers: state.servers.map((server) => server.origin),
      active: state.active,
    });
  },
});

export const naigiMobile = {
  platform: "capacitor",
  build,
  permissions,
  PERMISSIONS,
  maxServers: MAX_SERVERS,
  servers: {
    list: () => store.list(),
    add: (value, name) => store.add(value, name),
    select: (value) => store.select(value),
    remove: (value) => store.remove(value),
    rename: (value, name) => store.rename(value, name),
    clear: () => store.clear(),
    verify: verifyServer,
  },
  /** Read by the mobile platform adapter on every request, so it stays current. */
  get serverOrigin() {
    return store.list().active;
  },
  hasServer: () => store.list().active !== null,
};

globalThis.naigiMobile = naigiMobile;
