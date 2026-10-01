import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { buildTarget, readPackageVersion, repoRoot, requireBuild, resolveFrontendDir, webDir } from "./frontend-source.mjs";

const run = promisify(execFile);

const frontendDir = resolveFrontendDir(repoRoot);
const skipBuild = process.argv.includes("--no-build");

if (!skipBuild) {
  // The shared frontend owns all user-facing UI; this repository only wraps it.
  await run("npm", ["run", `build:${buildTarget}`], { cwd: frontendDir, shell: process.platform === "win32" });
}

const build = requireBuild(frontendDir);
const target = webDir(repoRoot);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(build, target, { recursive: true });

const frontendVersion = readPackageVersion(frontendDir);
const appVersion = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")).version;

// Native glue is owned here, not in the shared frontend, so copy it in and load it
// on every page the way the desktop bundle loads its own bridge.
const nativeDir = path.join(repoRoot, "native");
await cp(nativeDir, path.join(target, "native"), { recursive: true });

// The picker is part of the app experience rather than the web interface, so it
// ships with the shell.
await cp(path.join(nativeDir, "picker.html"), path.join(target, "picker.html"));

let injected = 0;
for (const page of await readdir(target)) {
  if (!page.endsWith(".html")) continue;
  const file = path.join(target, page);
  const html = await readFile(file, "utf8");
  if (html.includes("/native/mobile.js")) continue;
  const buildInfo = { app: appVersion, frontend: frontendVersion, target: buildTarget };
  const bootstrap = `<script>window.__NAIGI_MOBILE_BUILD__=${JSON.stringify(buildInfo)};</script>\n  <script type="module" src="/native/mobile.js"></script>\n  <script type="module" src="/native/boot.js"></script>\n  </body>`;
  await writeFile(file, html.replace("</body>", bootstrap));
  injected += 1;
}

const notice = await readFile(path.join(target, "third-party-licenses.txt"), "utf8").catch(() => "");
console.log(`Synced naigi-frontend ${frontendVersion} (${buildTarget}) into www/ with native glue on ${injected} pages (${notice.length} bytes of third-party notices).`);
