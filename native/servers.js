// Saved Naigi servers for the mobile app.
//
// The bundled pages address /v1 on their own origin, so the app shell owns
// which server those requests belong to. This module is the single place that
// stores that choice; the native proxy reads the same value.

const STORAGE_KEY = "naigi.mobile.servers";
export const MAX_SERVERS = 10;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Accepts HTTPS origins, plus plain HTTP for loopback development only. */
export function normalizeServerOrigin(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Enter a server address.");
  const raw = value.trim();
  if (/[/?#@]/.test(raw.replace(/^https?:\/\//, "").replace(/:\d+$/, "")) && raw.includes("@")) {
    throw new Error("Credentials in the address are not allowed.");
  }
  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new Error("That is not a valid server address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only https addresses are supported.");
  if (url.username || url.password) throw new Error("Credentials in the address are not allowed.");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("Enter only the server origin, without a path.");
  if (url.protocol === "http:" && !LOOPBACK.has(url.hostname)) {
    throw new Error("Only https is allowed, except for a local server.");
  }
  return url.origin;
}

function readStore(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    const servers = Array.isArray(parsed.servers) ? parsed.servers : [];
    return { servers, active: typeof parsed.active === "string" ? parsed.active : null };
  } catch {
    return { servers: [], active: null };
  }
}

function writeStore(storage, store) {
  storage.setItem(STORAGE_KEY, JSON.stringify(store));
  return store;
}

/**
 * Server list storage. `storage` is injected so the logic is testable and so
 * the native layer can mirror the same value into platform preferences.
 */
export function createServerStore(storage, hooks = {}) {
  function commit(store) {
    writeStore(storage, store);
    hooks.onChange?.(store);
    return store;
  }

  function list() {
    const { servers, active } = readStore(storage);
    // Ignore a stale active pointer rather than reporting an unusable server.
    return { servers, active: servers.some((server) => server.origin === active) ? active : null };
  }

  function add(value, name) {
    const origin = normalizeServerOrigin(value);
    const { servers, active } = list();
    const existing = servers.find((server) => server.origin === origin);
    if (existing) {
      if (name) existing.name = name;
      commit({ servers, active: origin });
      return origin;
    }
    const next = [{ origin, name: name || "", addedAt: Date.now() }, ...servers].slice(0, MAX_SERVERS);
    commit({ servers: next, active: origin });
    return origin;
  }

  function select(value) {
    const origin = normalizeServerOrigin(value);
    if (!list().servers.some((server) => server.origin === origin)) throw new Error("That server is not saved.");
    return commit({ ...readStore(storage), active: origin }).active;
  }

  function remove(value) {
    const origin = normalizeServerOrigin(value);
    const { servers, active } = list();
    const next = servers.filter((server) => server.origin !== origin);
    return commit({ servers: next, active: active === origin ? next[0]?.origin ?? null : active });
  }

  function rename(value, name) {
    const origin = normalizeServerOrigin(value);
    const { servers, active } = list();
    const server = servers.find((candidate) => candidate.origin === origin);
    if (!server) throw new Error("That server is not saved.");
    server.name = name.slice(0, 60);
    return commit({ servers, active });
  }

  function clear() {
    return commit({ servers: [], active: null });
  }

  return { list, add, select, remove, rename, clear, active: () => list().active };
}

/** Confirms an address really is a Naigi server before saving it. */
export async function verifyServer(origin, request = fetch, serverPlugin) {
  const native = serverPlugin ?? globalThis.Capacitor?.Plugins?.NaigiServer;
  if (native?.verify) {
    // In the app the check runs natively, which also reports why it failed
    // (DNS, TLS, unreachable, or not a Naigi server) instead of one message.
    let result;
    try {
      result = await native.verify({ origin });
    } catch (error) {
      throw codedError(error);
    }
    if (!result || typeof result.version !== "string" || !result.version) {
      throw codedError({ code: "not_a_naigi_server" });
    }
    return { version: result.version, origin };
  }
  let response;
  try {
    response = await request(new URL("/v1/version", origin), {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error("Could not reach that server.");
  }
  if (!response.ok) throw new Error(`The server answered with ${response.status}.`);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("That address did not answer like a Naigi server.");
  }
  if (data?.name !== "Naigi" || typeof data.version !== "string") {
    throw new Error("That address did not answer like a Naigi server.");
  }
  return { version: data.version, origin };
}

/** Attaches a stable code to an error so the picker can explain it. */
export function codedError(error) {
  const code = typeof error?.code === "string" ? error.code : "naigi_request_failed";
  return Object.assign(new Error(code), { code });
}
