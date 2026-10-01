import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The shared frontend build target this app wraps. */
export const buildTarget = "mobile";

/** Locates the shared frontend checkout that provides the bundled app pages. */
export function resolveFrontendDir(root = repoRoot, override = process.env.NAIGI_FRONTEND_DIR) {
  const candidate = path.resolve(root, override ?? "../naigi-frontend");
  if (!existsSync(path.join(candidate, "package.json"))) {
    throw new Error(`Shared frontend not found at ${candidate}. Clone naigi-frontend next to this repository or set NAIGI_FRONTEND_DIR.`);
  }
  return candidate;
}

export function buildDir(frontendDir, target = buildTarget) {
  if (target !== "mobile" && target !== "web" && target !== "desktop") throw new Error(`unknown_build_target:${target}`);
  return path.join(frontendDir, ".build", target);
}

/** Returns true when a completed shared-frontend build is available. */
export function hasBuild(frontendDir, target = buildTarget) {
  const build = buildDir(frontendDir, target);
  return existsSync(path.join(build, "index.html")) && existsSync(path.join(build, "app.css"));
}

export function requireBuild(frontendDir, target = buildTarget) {
  const build = buildDir(frontendDir, target);
  if (!hasBuild(frontendDir, target)) {
    throw new Error(`Missing ${target} build in ${build}. Run "npm run build:${target}" in the shared frontend first.`);
  }
  return build;
}

export function webDir(root = repoRoot) {
  return path.join(root, "www");
}

export function readPackageVersion(frontendDir) {
  const manifest = path.join(frontendDir, "package.json");
  if (!existsSync(manifest)) throw new Error(`Missing ${manifest}`);
  const { version } = JSON.parse(readFileSync(manifest, "utf8"));
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) throw new Error(`Unreadable frontend version in ${manifest}`);
  return version;
}

export function assertDirectory(target) {
  if (!existsSync(target) || !statSync(target).isDirectory()) throw new Error(`Expected a directory: ${target}`);
}
