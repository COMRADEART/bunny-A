// Render the exact Windows package's built middleware, using the same Node HTTP adapter as Bunny-Server.mjs.
// QA only: loopback 8081, disposable Host credential supplied externally, never an installed service.
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const packageRoot = resolve(import.meta.dirname, "windows-package-closeout/Bunny-A-Windows-MA3-T13-FINAL-TEST");
const { middleware } = await import(pathToFileURL(resolve(packageRoot, ".output/server/index.mjs")).href);
const server = createServer((request, response) => {
  response.on("error", () => response.destroy());
  Promise.resolve(middleware(request, response)).catch((error) => {
    console.error(error.message);
    if (!response.headersSent) response.writeHead(500);
    response.end("Test package preview failed.");
  });
});
server.listen(8081, "127.0.0.1", () => console.log("T13 final Windows package preview ready."));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.closeAllConnections(); server.close(); });
