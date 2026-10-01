// Native bridge exposed to the bundled Naigi pages inside the app shell.
import { permissions, PERMISSIONS } from "./permissions.js";

const build = globalThis.__NAIGI_MOBILE_BUILD__ ?? null;

export const naigiMobile = {
  platform: "capacitor",
  build,
  permissions,
  PERMISSIONS,
};

globalThis.naigiMobile = naigiMobile;
