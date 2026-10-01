// Sends the bundled page's /v1 calls to the selected Naigi server.
//
// The app serves its own pages from a local scheme, so a request to "/v1/..."
// would never reach a server. Rewriting the origin here keeps the shared
// frontend unaware of the app shell, and going through the platform keeps the
// session cookie in one place and avoids requiring the server to allow
// cross-origin requests.

const API_PREFIX = "/v1/";

/** True when a request the page made should be sent to the selected server. */
export function isApiRequest(url, appOrigin) {
  if (typeof url !== "string") return false;
  if (!url.startsWith("/") || url.startsWith("//")) return false;
  if (appOrigin && url.startsWith(appOrigin)) return false;
  return url.startsWith(API_PREFIX) || url === API_PREFIX.slice(0, -1);
}

export function apiTarget(url, origin) {
  if (!origin) throw new Error("no_naigi_server");
  return new URL(url, origin).toString();
}

function encodeBody(body) {
  if (body === undefined || body === null || body === "") return undefined;
  if (typeof body === "string") {
    return { base64: btoa(String.fromCharCode(...new TextEncoder().encode(body))), text: body };
  }
  if (body instanceof URLSearchParams) return encodeBody(body.toString());
  // A typed array or blob is already binary; the app sends encrypted bytes.
  return { bytes: body };
}

function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Builds the request object the native plugin expects. */
export function toNativeRequest(url, init, origin) {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = {};
  const incoming = init?.headers;
  if (incoming instanceof Headers) incoming.forEach((value, key) => { headers[key] = value; });
  else if (Array.isArray(incoming)) for (const [key, value] of incoming) headers[key] = value;
  else if (incoming && typeof incoming === "object") Object.assign(headers, incoming);
  // The browser adds these itself; the platform request must not.
  delete headers["accept-encoding"];
  delete headers["content-length"];

  let body;
  const encoded = encodeBody(init?.body);
  if (encoded) {
    if (encoded.text !== undefined) body = toBase64(new TextEncoder().encode(encoded.text));
    else if (encoded.bytes) body = toBase64(new Uint8Array(encoded.bytes));
  }
  return { url: apiTarget(url, origin), method, headers, body };
}

/** Rebuilds a Response from what the native plugin returned. */
export function toResponse(result) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(result?.headers ?? {})) {
    if (typeof value === "string") headers.set(key, value);
  }
  const bytes = result?.body ? decodeBase64(result.body) : new Uint8Array();
  // 204 and 304 must not carry a body.
  const empty = result?.status === 204 || result?.status === 304;
  return new Response(empty ? null : bytes, { status: result?.status ?? 502, statusText: "", headers });
}

// Only controlled plugin codes may travel back to the page. Anything else is
// a bug or tampering, so it becomes the generic failure.
const KNOWN_ERRORS = new Set([
  "dns_failed",
  "tls_failed",
  "connect_failed",
  "not_a_naigi_server",
  "invalid_naigi_origin",
  "invalid_naigi_url",
  "invalid_naigi_request",
  "invalid_request_body",
  "request_too_large",
  "no_naigi_server",
  "naigi_request_failed",
]);

export function pluginErrorCode(error) {
  const code = typeof error?.code === "string" ? error.code : null;
  return code && KNOWN_ERRORS.has(code) ? code : "naigi_request_failed";
}

/**
 * Installs the bridge. Returns a function that restores the original fetch.
 * Requests that are not /v1 calls, and any failure to reach the platform, fall
 * through to the original implementation.
 */
export function installApiBridge({ fetch: originalFetch, plugin, getOrigin, appOrigin = "" }) {
  if (typeof originalFetch !== "function" || !plugin?.request) return () => {};

  const bridge = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!isApiRequest(url, appOrigin)) return originalFetch(input, init);

    const origin = getOrigin();
    if (!origin) {
      return new Response(JSON.stringify({ error: "no_naigi_server" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    try {
      const request = toNativeRequest(url, init, origin);
      const result = await plugin.request(request);
      return toResponse(result);
    } catch (error) {
      return new Response(JSON.stringify({ error: pluginErrorCode(error) }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
  };

  globalThis.fetch = bridge;
  return () => { globalThis.fetch = originalFetch; };
}

/**
 * Installs the bridge as soon as the native plugin shows up. The page's modules
 * can run before Capacitor finishes exposing its plugins, and a bridge that
 * never installs fails in the worst way: /v1 calls fall through to the app's
 * own origin, whose local server answers them with index.html and a 200 status.
 */
export function ensureApiBridge({ fetch: originalFetch, getPlugin, getOrigin, appOrigin = "", retries = 50, interval = 100 }) {
  return new Promise((resolve) => {
    const attempt = (left) => {
      const plugin = getPlugin();
      if (plugin?.request) {
        installApiBridge({ fetch: originalFetch, plugin, getOrigin, appOrigin });
        resolve(true);
        return;
      }
      if (left <= 0) {
        console.error("[Naigi] native API bridge unavailable; server requests cannot leave the app.");
        resolve(false);
        return;
      }
      setTimeout(() => attempt(left - 1), interval);
    };
    attempt(retries);
  });
}
