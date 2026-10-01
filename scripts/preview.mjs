// Serves the synced www/ bundle so the mobile UI can be opened in a desktop
// browser at phone size. The bundled pages use absolute paths such as
// /app.css, so opening the files directly from disk does not work.
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { webDir, repoRoot } from "./frontend-source.mjs";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

const root = webDir(repoRoot);
if (!existsSync(root)) {
  console.error("www/ is missing. Run `npm run sync` first.");
  process.exit(1);
}

const requested = process.argv[2] ?? "/chat.html";
const port = Number(process.env.PORT ?? 4173);

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";
  const file = path.join(root, path.normalize(pathname).replace(/^([/\\])+/, ""));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
});

server.listen(port, () => {
  console.log(`Mobile preview: http://localhost:${port}${requested}\n(Use a phone viewport, for example 390x844.)`);
});
