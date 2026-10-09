const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const modulePath = path.join(__dirname, "..", "native", "permissions.js");

function load() {
  return import(`file:///${modulePath.replace(/\\/g, "/")}?t=${Date.now()}`);
}

function stubBridge(states = {}) {
  const calls = [];
  return {
    calls,
    status: async () => ({ permissions: states }),
    request: async ({ alias }) => {
      calls.push(alias);
      return states[alias] ?? { alias, granted: false, prompt: true };
    },
  };
}

test("every permission the app may ask for explains itself before prompting", async () => {
  const { PERMISSIONS, createPermissionsApi } = await load();
  for (const alias of ["microphone", "camera", "bluetooth", "notifications"]) {
    assert.equal(PERMISSIONS[alias].title.length > 0, true);
    assert.match(PERMISSIONS[alias].reason, /Naigi needs|Naigi uses/);
    assert.ok(PERMISSIONS[alias].usedBy.length > 0);
  }
  const api = createPermissionsApi(stubBridge());
  assert.equal(Object.keys(PERMISSIONS).length, 4);
  assert.equal(api.available, true);
});

test("a plugin that registers late is still found, rather than silently never asked", async () => {
  const { createPermissionsApi } = await load();
  // Capacitor registers plugins after the page's modules evaluate, so a bridge captured once at
  // import time reports itself unavailable forever and every request becomes a no-op.
  let plugin;
  const api = createPermissionsApi(() => plugin);
  assert.equal(api.available, false);
  const early = await api.request("camera");
  assert.equal(early.granted, false);
  // Before the plugin exists the caller is told it is unavailable, so it can let the browser ask.
  assert.equal(early.unavailable, true);

  plugin = stubBridge({ camera: { granted: true, prompt: false, supported: true } });
  assert.equal(api.available, true);
  const granted = await api.request("camera");
  assert.equal(granted.granted, true);
});

test("a request returns the granted state together with the reason", async () => {
  const { createPermissionsApi } = await load();
  const bridge = stubBridge({ microphone: { granted: true, prompt: false, supported: true } });
  const api = createPermissionsApi(bridge);
  const result = await api.request("microphone");
  assert.deepEqual(bridge.calls, ["microphone"]);
  assert.equal(result.granted, true);
  assert.equal(result.blocked, false);
  assert.match(result.reason, /microphone/);
});

test("a permanent refusal is reported as blocked so the UI can open settings", async () => {
  const { createPermissionsApi } = await load();
  const api = createPermissionsApi(stubBridge({ microphone: { granted: false, blocked: true, supported: true } }));
  const result = await api.current("microphone");
  assert.equal(result.granted, false);
  assert.equal(result.blocked, true);
  assert.equal(result.prompt, false);
});

test("unknown and unsupported permissions never prompt", async () => {
  const { createPermissionsApi } = await load();
  const bridge = stubBridge();
  const api = createPermissionsApi(bridge);
  for (const alias of ["contacts", "", "camera2"]) {
    const result = await api.request(alias);
    assert.equal(result.unavailable, true);
    assert.equal(result.supported, false);
  }
  assert.deepEqual(bridge.calls, []);
});

test("permissions introduced in a later Android release report as unavailable", async () => {
  const { createPermissionsApi } = await load();
  const api = createPermissionsApi(stubBridge({ notifications: { supported: false, granted: false } }));
  const result = await api.request("notifications");
  assert.equal(result.supported, false);
  assert.equal(result.granted, false);
  assert.equal(result.unavailable, false);
});

test("requests are sequential so only one system dialog is open at a time", async () => {
  const { createPermissionsApi } = await load();
  const bridge = stubBridge();
  const api = createPermissionsApi(bridge);
  const results = await api.requestAll(["microphone", "camera"]);
  assert.deepEqual(bridge.calls, ["microphone", "camera"]);
  assert.deepEqual(Object.keys(results), ["microphone", "camera"]);
});

test("the same page bundle works outside the app shell without a native bridge", async () => {
  const { createPermissionsApi } = await load();
  const api = createPermissionsApi(undefined);
  assert.equal(api.available, false);
  assert.deepEqual(await api.status(), {});
  const result = await api.request("microphone");
  assert.equal(result.unavailable, true);
  assert.equal(result.granted, false);
  assert.match(result.reason, /microphone/);
});
