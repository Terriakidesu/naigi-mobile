const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const modulePath = path.join(__dirname, "..", "native", "api-bridge.js");

function load() {
  return import(`file:///${modulePath.replace(/\\/g, "/")}?t=${Date.now()}`);
}

const globalsBackup = {};
function withBrowserGlobals() {
  for (const name of ["btoa", "atob", "Headers", "Response", "URL", "TextEncoder", "Uint8Array", "fetch", "FormData"]) {
    globalsBackup[name] = globalThis[name];
  }
  globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");
  globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");
  globalThis.Headers = Headers;
  globalThis.Response = Response;
  globalThis.TextEncoder = TextEncoder;
}
function restoreBrowserGlobals() {
  for (const [name, value] of Object.entries(globalsBackup)) {
    if (value === undefined) delete globalThis[name];
    else globalThis[name] = value;
  }
}

test("only same-origin /v1 requests are sent to the server", async () => {
  const { isApiRequest } = await load();
  for (const url of ["/v1/me", "/v1/crypto/keys/upload", "/v1/"]) {
    assert.equal(isApiRequest(url, "https://localhost"), true, `missed ${url}`);
  }
  for (const url of ["/app.css", "/main.js", "/native/mobile.js", "/picker.html", "//evil.example.com/v1/me", "https://evil.example.com/v1/me", "v1/me", ""]) {
    assert.equal(isApiRequest(url, "https://localhost"), false, `wrongly matched ${url}`);
  }
});

test("the target origin comes from the selected server, not the page", async () => {
  const { apiTarget } = await load();
  assert.equal(apiTarget("/v1/me", "https://chat.example.com"), "https://chat.example.com/v1/me");
  assert.equal(apiTarget("/v1/me?x=1", "https://chat.example.com"), "https://chat.example.com/v1/me?x=1");
  assert.equal(apiTarget("/v1/me", "http://127.0.0.1:3000"), "http://127.0.0.1:3000/v1/me");
  assert.throws(() => apiTarget("/v1/me", null), /no_naigi_server/);
});

test("a JSON body crosses the bridge intact and browser-managed headers are dropped", async () => {
  const { toNativeRequest } = await load();
  const request = toNativeRequest("/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "accept-encoding": "gzip", "content-length": "99" },
    body: JSON.stringify({ username: "terriakidesu", password: "s3cret" }),
  }, "https://chat.example.com");
  assert.equal(request.url, "https://chat.example.com/v1/auth/login");
  assert.equal(request.method, "POST");
  assert.equal(request.headers["content-type"], "application/json");
  assert.equal("accept-encoding" in request.headers, false);
  assert.equal("content-length" in request.headers, false);
  assert.equal(JSON.parse(Buffer.from(request.body, "base64").toString("utf8")).username, "terriakidesu");
});

test("header objects, header lists, and Headers instances all carry over", async () => {
  const { toNativeRequest } = await load();
  const plain = toNativeRequest("/v1/me", { headers: { accept: "application/json" } }, "https://a.example.com");
  assert.equal(plain.headers.accept, "application/json");
  const list = toNativeRequest("/v1/me", { headers: [["accept", "text/plain"]] }, "https://a.example.com");
  assert.equal(list.headers.accept, "text/plain");
  const instance = toNativeRequest("/v1/me", { headers: new Headers({ accept: "application/json" }) }, "https://a.example.com");
  assert.equal(instance.headers.accept, "application/json");
});

test("a body-less GET sends no payload", async () => {
  const { toNativeRequest } = await load();
  const request = toNativeRequest("/v1/me", {}, "https://a.example.com");
  assert.equal(request.method, "GET");
  assert.equal(request.body, undefined);
});

test("the native result becomes a real Response the app can parse", async () => {
  const { toResponse } = await load();
  const payload = Buffer.from(JSON.stringify({ user: { id: "u1" } }), "utf8").toString("base64");
  const response = toResponse({ status: 200, headers: { "content-type": "application/json" }, body: payload });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), { user: { id: "u1" } });
});

test("an empty response and a 204 stay bodyless", async () => {
  const { toResponse } = await load();
  assert.equal(await toResponse({ status: 200, headers: {}, body: "" }).text(), "");
  assert.equal(toResponse({ status: 204, headers: {}, body: "aGk=" }).body, null);
});

test("binary downloads round-trip byte for byte", async () => {
  const { toResponse } = await load();
  const original = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const response = toResponse({
    status: 200,
    headers: { "content-type": "application/octet-stream" },
    body: Buffer.from(original).toString("base64"),
  });
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), original);
});

test("non-API requests are left to the browser untouched", async () => {
  withBrowserGlobals();
  try {
    const { installApiBridge } = await load();
    const calls = [];
    const restore = installApiBridge({
      fetch: async (url) => { calls.push(String(url)); return new Response("ok"); },
      plugin: { request: async () => { throw new Error("should not be called"); } },
      getOrigin: () => "https://chat.example.com",
      appOrigin: "https://localhost",
    });
    const response = await fetch("https://localhost/app.css");
    assert.equal(await response.text(), "ok");
    assert.deepEqual(calls, ["https://localhost/app.css"]);
    restore();
  } finally {
    restoreBrowserGlobals();
  }
});

test("API requests reach the selected server through the platform", async () => {
  withBrowserGlobals();
  try {
    const { installApiBridge } = await load();
    const seen = [];
    const restore = installApiBridge({
      fetch: async () => new Response("browser"),
      plugin: { request: async (request) => {
        seen.push(request);
        return { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from('{"ok":true}').toString("base64") };
      } },
      getOrigin: () => "https://chat.example.com",
      appOrigin: "https://localhost",
    });
    const response = await fetch("/v1/me", { method: "POST", body: "{}" });
    assert.equal(await response.text(), '{"ok":true}');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "https://chat.example.com/v1/me");
    assert.equal(seen[0].method, "POST");
    restore();
  } finally {
    restoreBrowserGlobals();
  }
});

test("with no server selected the app gets a clear error instead of a network failure", async () => {
  withBrowserGlobals();
  try {
    const { installApiBridge } = await load();
    const restore = installApiBridge({
      fetch: async () => new Response("browser"),
      plugin: { request: async () => { throw new Error("unreachable"); } },
      getOrigin: () => null,
      appOrigin: "https://localhost",
    });
    const response = await fetch("/v1/me");
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "no_naigi_server");
    restore();
  } finally {
    restoreBrowserGlobals();
  }
});

test("a platform failure becomes a 502 rather than an unhandled rejection", async () => {
  withBrowserGlobals();
  try {
    const { installApiBridge } = await load();
    const restore = installApiBridge({
      fetch: async () => new Response("browser"),
      plugin: { request: async () => { throw new Error("socket closed"); } },
      getOrigin: () => "https://chat.example.com",
      appOrigin: "https://localhost",
    });
    const response = await fetch("/v1/me");
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "naigi_request_failed");
    restore();
  } finally {
    restoreBrowserGlobals();
  }
});

test("installing without a platform plugin changes nothing", async () => {
  withBrowserGlobals();
  try {
    const { installApiBridge } = await load();
    const before = globalThis.fetch;
    const restore = installApiBridge({ fetch: before, plugin: undefined, getOrigin: () => null });
    assert.equal(globalThis.fetch, before);
    restore();
  } finally {
    restoreBrowserGlobals();
  }
});
