// Desktop build QA uses the same native HTTP adapter as install/Bunny-Server.mjs.
// Nitro's generic Vite preview does not serve a node-middleware output directly.
import { createServer } from "node:http";
import { middleware } from "../.output/server/index.mjs";
const server = createServer((request, response) => {
  response.on("error", () => response.destroy());
  Promise.resolve(middleware(request, response)).catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end("Desktop preview request failed.");
  });
});
server.on("error", error => { console.error(error.message); process.exitCode = 1; });
server.listen(8081, "127.0.0.1", () => console.log("Desktop production preview ready."));
