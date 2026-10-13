// QA-only listener, serving the final packaged node-middleware build with the same native HTTP adapter as the gateway.
// Does not execute or alter the packaged fixed-port gateway, which remains NOT TESTED at the production-owned port.
import { createServer } from "node:http";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
process.env.BUNNY_HOST_PORT = "43145";
process.env.BUNNY_HOST_DATA_DIRECTORY = join(tmpdir(), "bunny-t5-preview-bun-router");
delete process.env.BUNNY_STATE_LAYOUT;
delete process.env.BUNNY_HOST_CREDENTIALS_FILE;
delete process.env.BUNNY_RELEASE_ROOT;
const output = resolve(import.meta.dirname, "windows-package-closeout/Bunny-A-Windows-MA3-T12-TEST/.output/server/index.mjs");
const { middleware } = await import(pathToFileURL(output).href);
const server = createServer((request, response) => {
  response.on("error", () => response.destroy());
  Promise.resolve(middleware(request, response)).catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end("Package QA preview failed.");
  });
});
server.on("error", error => { console.error(error.message); process.exitCode=1; });
server.listen(8081, "127.0.0.1", () => console.log("Final packaged dashboard QA listener ready."));
process.on("SIGINT", () => server.close(() => process.exit(0)));
