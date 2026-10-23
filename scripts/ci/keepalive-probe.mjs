// MA4-S1R3-CI2 diagnostic probe: does fetch reuse a pooled keep-alive socket after a same-port server restart?
import http from "node:http";
const port = 43999;
const serve = () => new Promise((r) => { const s = http.createServer((q, a) => a.end("ok")); s.listen(port, "127.0.0.1", () => r(s)); });
let fails = 0, delayMs = Number(process.argv[2] ?? 0);
const runs = Number(process.argv[3] ?? 200);
for (let i = 0; i < runs; i++) {
  const a = await serve();
  await (await fetch(`http://127.0.0.1:${port}/`)).text();
  a.closeAllConnections(); await new Promise((r) => a.close(r));
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  const b = await serve();
  try { await (await fetch(`http://127.0.0.1:${port}/`)).text(); } catch (e) { fails++; if (fails === 1) console.log(e.message, e.cause?.code, e.cause?.message); }
  b.closeAllConnections(); await new Promise((r) => b.close(r));
}
console.log(`delay ${delayMs}ms: ${fails}/${runs} fetches after a same-port restart failed`);
