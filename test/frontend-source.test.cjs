const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const modulePath = path.join(__dirname, "..", "scripts", "frontend-source.mjs");

function load() {
  return import(`file:///${modulePath.replace(/\\/g, "/")}?t=${Date.now()}`);
}

function frontendCheckout(name = "naigi-frontend") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "naigi-mobile-"));
  const frontend = path.join(root, name);
  fs.mkdirSync(frontend, { recursive: true });
  fs.writeFileSync(path.join(frontend, "package.json"), JSON.stringify({ name: "naigi-frontend", version: "0.2.0" }));
  return { root, frontend };
}

test("the shared frontend is required and must be a real checkout", async () => {
  const { resolveFrontendDir } = await load();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "naigi-mobile-"));
  assert.throws(() => resolveFrontendDir(root), /Shared frontend not found/);
  const empty = path.join(root, "empty");
  fs.mkdirSync(empty, { recursive: true });
  assert.throws(() => resolveFrontendDir(root, "empty"), /Shared frontend not found/);
});

test("an override directory is used when it contains the frontend", async () => {
  const { resolveFrontendDir } = await load();
  const { root, frontend } = frontendCheckout("frontend-checkout");
  assert.equal(resolveFrontendDir(root, "frontend-checkout"), frontend);
});

test("the app wraps the mobile build, not the desktop or web one", async () => {
  const { buildDir, buildTarget, hasBuild } = await load();
  assert.equal(buildTarget, "mobile");
  assert.equal(buildDir("/checkout").endsWith(path.join(".build", "mobile")), true);
  assert.throws(() => buildDir("/checkout", "electron"), /unknown_build_target/);
  const { frontend } = frontendCheckout();
  assert.equal(hasBuild(frontend), false);
});

test("a missing mobile build is refused instead of shipping an empty app", async () => {
  const { hasBuild, requireBuild, buildDir } = await load();
  const { frontend } = frontendCheckout();
  assert.equal(hasBuild(frontend), false);
  assert.throws(() => requireBuild(frontend), /Missing mobile build/);
  fs.mkdirSync(buildDir(frontend), { recursive: true });
  fs.writeFileSync(path.join(buildDir(frontend), "index.html"), "<!doctype html>");
  assert.equal(hasBuild(frontend), false);
  fs.writeFileSync(path.join(buildDir(frontend), "app.css"), "body{}");
  assert.equal(requireBuild(frontend), buildDir(frontend));
});

test("the bundled frontend version is recorded for About and diagnostics", async () => {
  const { readPackageVersion } = await load();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "naigi-mobile-"));
  assert.throws(() => readPackageVersion(root), /Missing/);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "naigi-frontend", version: "not-a-version" }));
  assert.throws(() => readPackageVersion(root), /Unreadable frontend version/);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "naigi-frontend", version: "0.2.0" }));
  assert.equal(readPackageVersion(root), "0.2.0");
});
