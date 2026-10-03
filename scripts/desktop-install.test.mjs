import assert from "node:assert/strict";
import test from "node:test";
import { allowedOrigins, requestAllowed, desktopManifest } from "../install/manifest.mjs";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

test("desktop runtime refuses unknown hosts and cross-site writes", () => {
  const origins = allowedOrigins();
  assert.equal(requestAllowed({ host: "127.0.0.1:8082" }, "GET", origins), true);
  assert.equal(requestAllowed({ host: "attacker.example" }, "GET", origins), false);
  assert.equal(requestAllowed({ host: "127.0.0.1:8082", origin: "https://attacker.example" }, "POST", origins), false);
  assert.equal(requestAllowed({ host: "127.0.0.1:8082", "sec-fetch-site": "cross-site" }, "POST", origins), false);
});
test("remote runtime accepts only an explicitly configured HTTPS origin", () => {
  const origins = allowedOrigins("https://jev.example/");
  assert.equal(requestAllowed({ host: "jev.example", origin: "https://jev.example" }, "POST", origins), true);
  assert.equal(requestAllowed({ host: "localhost:8082", "x-forwarded-host": "jev.example", origin: "https://jev.example" }, "POST", origins), true);
  assert.equal(requestAllowed({ host: "localhost:8082", "x-forwarded-host": "unknown.example" }, "GET", origins), false);
  for (const url of ["http://jev.example", "https://a:b@jev.example", "https://jev.example/path", "https://jev.example/?key=secret"]) {
    assert.throws(() => allowedOrigins(url));
  }
});
test("Android manifest supplies standalone display and both required icon sizes", () => {
  assert.equal(desktopManifest.display, "standalone");
  assert.deepEqual(desktopManifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
});
test("MA1: the desktop package copies every source folder the native Host imports", () => {
  // The package ships install/Bunny-Host.mjs plus the src/lib folders named in package-bunny-desktop.ps1, with no npm install.
  const root = fileURLToPath(new URL("..", import.meta.url));
  const script = readFileSync(join(root, "scripts/package-bunny-desktop.ps1"), "utf8");
  const listed = script.match(/foreach\(\$directory in @\(([^)]*)\)\)/);
  assert.ok(listed, "package script names the copied src/lib folders");
  const folders = [...listed[1].matchAll(/'([^']+)'/g)].map((match) => `src/lib/${match[1]}/`);
  const specifiers = /(?:import|export)\s[^;]*?\sfrom\s*["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)|import\s*["'](\.[^"']+)["']/g;
  const seen = new Set(); const queue = [join(root, "install/Bunny-Host.mjs")]; const outside = [];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(specifiers)) {
      const spec = match[1] ?? match[2] ?? match[3];
      // install/* files sit at the package root, next to src/.
      const target = resolve(dirname(file.startsWith(join(root, "install")) ? join(root, "Bunny-Host.mjs") : file), spec);
      const rel = relative(root, target).replaceAll("\\", "/");
      if (rel.startsWith("src/")) { if (!folders.some((folder) => rel.startsWith(folder)) || rel.endsWith(".test.ts")) outside.push(rel); else if (existsSync(target)) queue.push(target); }
    }
  }
  assert.ok(seen.size > 10, "walked the Host import graph");
  assert.deepEqual(outside, [], `Host imports files the package does not copy: ${outside.join(", ")}`);
});
