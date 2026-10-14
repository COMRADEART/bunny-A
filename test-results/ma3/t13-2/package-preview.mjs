// Render the exact Windows test package's built dashboard middleware with the same Node HTTP adapter as Bunny-Server.mjs.
// QA only: loopback 8081, pointed at a DISPOSABLE Host through BUNNY_HOST_CREDENTIALS_FILE; never an installed service.
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.env.BUNNY_HOST_CREDENTIALS_FILE) throw new Error("Set BUNNY_HOST_CREDENTIALS_FILE to the disposable Host credentials.");
const packageRoot = resolve(import.meta.dirname, "windows-package/Bunny-A-Windows-MA3-T13-2-R4-TEST");
const { middleware } = await import(pathToFileURL(resolve(packageRoot, ".output/server/index.mjs")).href);
const server = createServer((request, response) => {
  response.on("error", () => response.destroy());
  Promise.resolve(middleware(request, response)).catch((error) => {
    console.error(error.message);
    if (!response.headersSent) response.writeHead(500);
    response.end("Test package preview failed.");
  });
});
server.listen(8081, "127.0.0.1", () => console.log("T13.2 Windows test package preview ready."));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.closeAllConnections(); server.close(); process.exit(0); });
