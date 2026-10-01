// Runtime permission requests for the native app.
//
// Permissions are requested by the feature that needs them, never at launch.
// The shared UI asks this module before joining a voice room, sharing video, or
// enabling notifications, and uses the returned `blocked` flag to explain that
// the user has to change the choice in system settings.

export const PERMISSIONS = {
  microphone: {
    title: "Microphone access",
    reason: "Naigi needs the microphone for encrypted voice rooms and calls.",
    usedBy: ["voice rooms", "voice calls"],
  },
  camera: {
    title: "Camera access",
    reason: "Naigi needs the camera only while you share video.",
    usedBy: ["video sharing"],
  },
  bluetooth: {
    title: "Bluetooth access",
    reason: "Naigi uses Bluetooth to route calls to headsets and speakers.",
    usedBy: ["bluetooth headsets"],
  },
  notifications: {
    title: "Notifications",
    reason: "Naigi uses notifications to tell you about new messages and calls.",
    usedBy: ["push messages", "call notifications"],
  },
};

const UNKNOWN = Object.freeze({ alias: "", supported: false, granted: false, blocked: false, prompt: false, unavailable: true });

/**
 * Wraps the native permission plugin. `bridge` is the injected `NaigiPermissions`
 * plugin; when it is missing (for example in a browser) every call resolves to an
 * explicit "unavailable" result instead of throwing.
 */
export function createPermissionsApi(bridge) {
  const unavailable = () => bridge ? undefined : UNKNOWN;

  async function status() {
    if (!bridge) return {};
    const result = await bridge.status();
    return result?.permissions ?? {};
  }

  async function current(alias) {
    if (!PERMISSIONS[alias]) return { ...UNKNOWN, alias };
    if (!bridge) return { ...UNKNOWN, alias, ...PERMISSIONS[alias] };
    const permissions = await status();
    return normalize(alias, permissions[alias]);
  }

  /** Requests one permission and returns the resulting state with its explanation. */
  async function request(alias) {
    if (!PERMISSIONS[alias]) return { ...UNKNOWN, alias };
    if (!bridge) return { ...UNKNOWN, alias, ...PERMISSIONS[alias] };
    const result = await bridge.request({ alias });
    return normalize(alias, result);
  }

  /** Requests several permissions in order, returning every outcome. */
  async function requestAll(aliases) {
    const results = {};
    for (const alias of aliases) results[alias] = await request(alias);
    return results;
  }

  return { available: Boolean(bridge), status, current, request, requestAll, unavailable };
}

function normalize(alias, value) {
  const state = value ?? {};
  return {
    alias,
    ...PERMISSIONS[alias],
    supported: state.supported !== false,
    granted: state.granted === true,
    // A permanent refusal cannot be re-prompted; the UI must offer system settings.
    blocked: state.blocked === true,
    prompt: state.prompt === true,
    unavailable: state.unavailable === true,
  };
}

export const permissions = createPermissionsApi(globalThis.Capacitor?.Plugins?.NaigiPermissions);
