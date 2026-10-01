const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const modulePath = path.join(__dirname, "..", "native", "servers.js");

function load() {
  return import(`file:///${modulePath.replace(/\\/g, "/")}?t=${Date.now()}`);
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    get length() { return values.size; },
  };
}

test("only https origins are accepted, with loopback as the one exception", async () => {
  const { normalizeServerOrigin } = await load();
  assert.equal(normalizeServerOrigin("https://chat.example.com"), "https://chat.example.com");
  assert.equal(normalizeServerOrigin("chat.example.com"), "https://chat.example.com");
  assert.equal(normalizeServerOrigin("https://chat.example.com/"), "https://chat.example.com");
  assert.equal(normalizeServerOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  assert.equal(normalizeServerOrigin("http://localhost:8080"), "http://localhost:8080");
  for (const input of ["http://chat.example.com", "http://192.168.1.10:3000", "ftp://chat.example.com", "ws://chat.example.com"]) {
    assert.throws(() => normalizeServerOrigin(input), /https|Only/i, `accepted ${input}`);
  }
});

test("credentials, paths, and junk addresses are rejected", async () => {
  const { normalizeServerOrigin } = await load();
  for (const input of ["https://user:pass@chat.example.com", "https://chat.example.com/v1", "https://chat.example.com?x=1", "https://chat.example.com#a", "", "   ", "not a url"]) {
    assert.throws(() => normalizeServerOrigin(input), undefined, `accepted ${JSON.stringify(input)}`);
  }
});

test("a new store starts empty and has no active server", async () => {
  const { createServerStore } = await load();
  const store = createServerStore(memoryStorage());
  assert.deepEqual(store.list(), { servers: [], active: null });
  assert.equal(store.active(), null);
});

test("adding a server makes it active and persists it", async () => {
  const { createServerStore } = await load();
  const storage = memoryStorage();
  const store = createServerStore(storage);
  store.add("https://one.example.com");
  assert.equal(store.active(), "https://one.example.com");
  // A fresh store over the same storage sees the saved server.
  const reopened = createServerStore(storage);
  assert.equal(reopened.list().servers.length, 1);
  assert.equal(reopened.active(), "https://one.example.com");
});

test("re-adding a known server selects it instead of duplicating", async () => {
  const { createServerStore } = await load();
  const store = createServerStore(memoryStorage());
  store.add("https://one.example.com");
  store.add("https://two.example.com");
  store.add("https://one.example.com");
  const { servers, active } = store.list();
  assert.equal(servers.length, 2);
  assert.equal(active, "https://one.example.com");
});

test("the most recently added server comes first and the list is bounded", async () => {
  const { createServerStore, MAX_SERVERS } = await load();
  const store = createServerStore(memoryStorage());
  for (let index = 0; index < MAX_SERVERS + 4; index += 1) store.add(`https://server${index}.example.com`);
  const { servers } = store.list();
  assert.equal(servers.length, MAX_SERVERS);
  assert.equal(servers[0].origin, `https://server${MAX_SERVERS + 3}.example.com`);
  assert.equal(servers.some((server) => server.origin === "https://server0.example.com"), false);
});

test("only saved servers can be selected", async () => {
  const { createServerStore } = await load();
  const store = createServerStore(memoryStorage());
  store.add("https://one.example.com");
  assert.throws(() => store.select("https://unknown.example.com"), /not saved/);
  store.add("https://two.example.com");
  assert.equal(store.select("https://one.example.com"), "https://one.example.com");
});

test("removing the active server promotes the next one and never leaves a dangling pointer", async () => {
  const { createServerStore } = await load();
  const storage = memoryStorage();
  const store = createServerStore(storage);
  store.add("https://one.example.com");
  store.add("https://two.example.com");
  store.remove("https://two.example.com");
  assert.equal(store.active(), "https://one.example.com");
  store.remove("https://one.example.com");
  assert.equal(store.active(), null);
  assert.equal(createServerStore(storage).active(), null);
});

test("a corrupt store cannot crash the picker", async () => {
  const { createServerStore } = await load();
  const store = createServerStore(memoryStorage({ "naigi.mobile.servers": "{not json" }));
  assert.deepEqual(store.list(), { servers: [], active: null });
  store.add("https://one.example.com");
  assert.equal(store.active(), "https://one.example.com");
});

test("a stale active pointer is ignored rather than offered to the app", async () => {
  const { createServerStore } = await load();
  const storage = memoryStorage({
    "naigi.mobile.servers": JSON.stringify({ servers: [], active: "https://gone.example.com" }),
  });
  const store = createServerStore(storage);
  assert.equal(store.active(), null);
  assert.equal(store.hasOwnProperty("list"), true);
});

test("renaming keeps the origin and is length bounded", async () => {
  const { createServerStore } = await load();
  const store = createServerStore(memoryStorage());
  store.add("https://one.example.com");
  store.rename("https://one.example.com", "Home");
  assert.equal(store.list().servers[0].name, "Home");
  store.rename("https://one.example.com", "x".repeat(200));
  assert.equal(store.list().servers[0].name.length, 60);
  assert.throws(() => store.rename("https://missing.example.com", "nope"), /not saved/);
});

test("verification only trusts an address that answers as Naigi", async () => {
  const { verifyServer } = await load();
  const ok = { ok: true, json: async () => ({ name: "Naigi", version: "0.26.0" }) };
  assert.deepEqual(await verifyServer("https://ok.example.com", async () => ok), { version: "0.26.0", origin: "https://ok.example.com" });
  for (const [response, pattern] of [
    [{ ok: false, status: 404 }, /404/],
    [{ ok: true, json: async () => { throw new Error("bad json"); } }, /did not answer/],
    [{ ok: true, json: async () => ({ name: "Something Else" }) }, /did not answer/],
    [{ ok: true, json: async () => ({ name: "Naigi" }) }, /did not answer/],
  ]) {
    await assert.rejects(() => verifyServer("https://x.example.com", async () => response), pattern);
  }
  await assert.rejects(() => verifyServer("https://x.example.com", async () => { throw new Error("offline"); }), /Could not reach/);
});

test("verification refuses to follow a redirect off the server", async () => {
  const { verifyServer } = await load();
  let seen = null;
  await assert.rejects(
    () => verifyServer("https://x.example.com", async (url, init) => {
      seen = init.redirect;
      throw new Error("offline");
    }),
    /Could not reach/,
  );
  assert.equal(seen, "error");
});

test("in the app, verification runs natively and keeps its error code", async () => {
  const { verifyServer } = await load();
  const plugin = { verify: async ({ origin }) => ({ origin, version: "0.26.0" }) };
  assert.deepEqual(
    await verifyServer("https://chat.example.com", async () => { throw new Error("must not use fetch"); }, plugin),
    { version: "0.26.0", origin: "https://chat.example.com" },
  );
  const failing = { verify: async () => { throw Object.assign(new Error("denied"), { code: "dns_failed" }); } };
  const error = await verifyServer("https://chat.example.com", async () => { throw new Error("must not use fetch"); }, failing).catch((e) => e);
  assert.equal(error.code, "dns_failed");
  const malformed = { verify: async () => ({ version: 42 }) };
  const bad = await verifyServer("https://chat.example.com", async () => { throw new Error("must not use fetch"); }, malformed).catch((e) => e);
  assert.equal(bad.code, "not_a_naigi_server");
});

test("a native failure without a code stays generic", async () => {
  const { verifyServer } = await load();
  const plugin = { verify: async () => { throw new Error("weird"); } };
  const error = await verifyServer("https://chat.example.com", async () => { throw new Error("must not use fetch"); }, plugin).catch((e) => e);
  assert.equal(error.code, "naigi_request_failed");
});
