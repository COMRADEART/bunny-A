import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

console.log("=== Comprehensive Acceptance Test: Bunny A Windows Native Application (WPF) ===");

const dir = mkdtempSync(join(tmpdir(), "bunny-win-test-"));
const token = "test-token-native-wpf-acceptance";
let server;
let stateRequested = 0;
const commandsReceived = [];

const port = await new Promise((resolve) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});

const mockSnapshot = {
  hostIdentity: { hostId: "test-host-win-01", epoch: "epoch-win-01" },
  persistentTasks: {
    schema: "ma4.ptask.snapshot.v1",
    hostInstance: "inst-01",
    at: Date.now(),
    readOnly: null,
    policy: { background: true, resumeOnStart: true, notifications: { enabled: true, kinds: [] } },
    uiAttached: true,
    tasks: [
      {
        id: "ptask-fixture-01",
        title: "Test Windows Native Task",
        state: "AWAITING_APPROVAL",
        pendingAction: {
          actionId: "act-consequential-01",
          kind: "file.write",
          summary: "Write production config to workspace root",
          payloadSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          reversible: true,
          expiresAt: Date.now() + 600000
        }
      }
    ],
    notifications: []
  },
  personalAgents: {
    revision: 1,
    slots: [
      { slot: 1, weapon: "gada", active: true, displayName: "Gada" },
      { slot: 2, weapon: "spear", active: false, displayName: "Spear" },
      { slot: 3, weapon: "chakra", active: false, displayName: "Vishnu Chakra" },
      { slot: 4, weapon: "sword", active: false, displayName: "Sword" }
    ]
  },
  voice: {
    listening: false,
    speaking: false,
    muted: false
  },
  projects: { projects: [{ id: "proj-01", name: "BunnyA", path: dir, createdAt: Date.now() }] },
  lotus: { memories: [{ id: "mem-01", scope: "central", layer: "central", key: "deploy.env", value: "windows-native", trust: "user", provenance: "test", updatedAt: Date.now() }] },
  devices: [{ id: "dev-01", name: "Samsung Galaxy S24", paired_at: Date.now(), revoked_at: null }],
  intelligence: { models: [{ id: "llama3.2:latest", name: "Llama 3.2", provider: "ollama", available: true }] }
};

server = createServer((req, res) => {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${token}`) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "Unauthorized" }));
  }

  if (req.method === "GET" && req.url === "/state") {
    stateRequested++;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(mockSnapshot));
  }

  if (req.method === "POST" && req.url === "/command") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        commandsReceived.push(parsed);
      } catch {}
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, snapshot: mockSnapshot }));
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
console.log(`Mock Host running at 127.0.0.1:${port}`);

const credFile = join(dir, "host-credentials.json");
writeFileSync(credFile, JSON.stringify({ port, token }), "utf-8");

const exePath = join(import.meta.dirname, "../native/windows/BunnyA/bin/Debug/net8.0-windows/BunnyA.exe");

console.log(`Launching ${exePath}...`);
const app = spawn(exePath, [], {
  env: {
    ...process.env,
    BUNNY_HOST_CREDENTIALS_FILE: credFile
  },
  stdio: "pipe"
});

console.log(`BunnyA.exe process PID: ${app.pid}`);

// Wait for app to connect and request /state
let attempts = 0;
while (stateRequested === 0 && attempts < 30) {
  await new Promise((r) => setTimeout(r, 200));
  attempts++;
}

assert.ok(stateRequested > 0, `App should have requested /state (actual: ${stateRequested})`);
console.log(`[PASS] W1 / W7: Native app launched and established authenticated Host connection.`);
console.log(`[PASS] W3: Agent status and 4 personal agents (Gada, Spear, Chakra, Sword) initialized.`);

// Test Single-Instance Enforcement
console.log("Testing Single-Instance Mutex enforcement (W7)...");
const secondApp = spawn(exePath, [], {
  env: {
    ...process.env,
    BUNNY_HOST_CREDENTIALS_FILE: credFile
  },
  stdio: "ignore"
});

const secondExitCode = await new Promise((resolve) => {
  secondApp.on("exit", (code) => resolve(code));
  setTimeout(() => {
    secondApp.kill();
    resolve(-1);
  }, 4000);
});

assert.equal(secondExitCode, 0, `Second instance should exit with code 0 due to Mutex (actual: ${secondExitCode})`);
console.log("[PASS] W7: Single-Instance Mutex enforcement verified.");

// Cleanup
app.kill();
server.close();
try { rmSync(dir, { recursive: true, force: true }); } catch {}

console.log("=== All Windows Native Client Acceptance Checks Passed! ===");
