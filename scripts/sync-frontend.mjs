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

// Version the glue URLs so an app update can never run stale cached scripts.
// A stale boot.js is fatal: /v1 calls fall through to the app origin, whose
// local server answers them with index.html and a 200 status.
const glueVersion = appVersion;
for (const file of ["mobile.js", "boot.js", "picker.js", "picker-link.js", "api-bridge.js", "servers.js", "permissions.js"]) {
  const script = path.join(target, "native", file);
  try {
    const source = await readFile(script, "utf8");
    await writeFile(script, source.replaceAll(/((?:from\s+|import\s*\(\s*)["']\.\/)([a-z-]+\.js)(["'])/g, `$1$2?v=${glueVersion}$3`));
  } catch {
    // Optional modules may not exist; the pages that need them fail loudly.
  }
}

// The picker is part of the app experience rather than the web interface, so it
// ships with the shell.
await cp(path.join(nativeDir, "picker.html"), path.join(target, "picker.html"));
{
  const picker = path.join(target, "picker.html");
  await writeFile(picker, (await readFile(picker, "utf8")).replaceAll("__NAIGI_GLUE_VERSION__", glueVersion));
}

// A phone user who picked the wrong server must be able to leave sign-in and
// choose again. The shared pages cannot link there, so add the way back.
for (const page of ["index.html", "register.html"]) {
  const file = path.join(target, page);
  const html = await readFile(file, "utf8");
  if (!html.includes("native/picker-link.js")) {
    await writeFile(file, html.replace(`  <script type="module" src="/native/boot.js?v=${glueVersion}"></script>\n  </body>`, `  <script type="module" src="/native/boot.js?v=${glueVersion}"></script>\n  <script type="module" src="/native/picker-link.js?v=${glueVersion}"></script>\n  </body>`));
  }
}

let injected = 0;
for (const page of await readdir(target)) {
  if (!page.endsWith(".html")) continue;
  const file = path.join(target, page);
  const html = await readFile(file, "utf8");
  if (html.includes("/native/mobile.js")) continue;
  const buildInfo = { app: appVersion, frontend: frontendVersion, target: buildTarget };
  const mobile = `  <script type="module" src="/native/mobile.js?v=${glueVersion}"></script>`;
  // Entry pages get a way back to the picker alongside the bridge.
  const extra = ["index.html", "register.html"].includes(page)
    ? `\n  <script type="module" src="/native/picker-link.js?v=${glueVersion}"></script>`
    : "";
  const bootstrap = `<script>window.__NAIGI_MOBILE_BUILD__=${JSON.stringify(buildInfo)};</script>\n${mobile}\n  <script type="module" src="/native/boot.js?v=${glueVersion}"></script>${extra}\n  </body>`;
  await writeFile(file, html.replace("</body>", bootstrap));
  injected += 1;
}

const notice = await readFile(path.join(target, "third-party-licenses.txt"), "utf8").catch(() => "");
console.log(`Synced naigi-frontend ${frontendVersion} (${buildTarget}) into www/ with native glue on ${injected} pages (${notice.length} bytes of third-party notices).`);
