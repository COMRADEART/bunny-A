import test from "node:test";
import assert from "node:assert/strict";
import { WORKER_ENV_ALLOWLIST, workerEnvironment } from "./voice-worker.server.ts";

const SECRET_NAMES = /(_API_KEY|_TOKEN|_SECRET|_PASSWORD|^ANTHROPIC_|^OPENAI_|^XAI_|^GITHUB_|^AZURE_|^AWS_|^BUNNY_|PASSWORD|CREDENTIAL)/i;

test("T10 H6 provider keys, tokens and Bunny settings never reach the worker environment", () => {
  const env = workerEnvironment({
    ANTHROPIC_API_KEY: "sk-ant-test",
    ANTHROPIC_BASE_URL: "https://example.invalid",
    OPENAI_API_KEY: "sk-test",
    OPENAI_ORG: "org-test",
    XAI_API_KEY: "xai-test",
    GITHUB_TOKEN: "ghp_test",
    MY_SERVICE_TOKEN: "token",
    DB_PASSWORD: "hunter2",
    BUNNY_HOST_DATA_DIRECTORY: "C:/data",
    NODE_OPTIONS: "--require evil.js",
    SystemRoot: "C:\\Windows",
    TEMP: "C:\\Users\\u\\AppData\\Local\\Temp",
  });
  for (const key of Object.keys(env)) assert.doesNotMatch(key, SECRET_NAMES, `${key} must not reach the worker`);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.SystemRoot, "C:\\Windows", "the system root the Windows audio stack needs is kept");
  assert.equal(env.TEMP, undefined, "privacy#2: temp is not forwarded; the recognition path does not need it");
});

test("privacy#2 the worker allowlist is pinned to the set the real worker needs, and profile or user variables never reach it", () => {
  assert.deepEqual([...WORKER_ENV_ALLOWLIST], ["SystemRoot", "windir"]);
  const env = workerEnvironment({ SystemRoot: "C:\\Windows", windir: "C:\\Windows", USERPROFILE: "C:\\Users\\u", APPDATA: "C:\\Users\\u\\AppData\\Roaming", LOCALAPPDATA: "C:\\x", USERNAME: "u", COMPUTERNAME: "PC", PUBLIC: "C:\\Users\\Public", HOMEDRIVE: "C:", HOMEPATH: "\\Users\\u" });
  assert.deepEqual(Object.keys(env).filter((key) => key !== "PATH").sort(), ["SystemRoot", "windir"]);
});

test("T10 H6 PATH is replaced by the Windows system directories only", () => {
  const env = workerEnvironment({ SystemRoot: "C:\\Windows", PATH: "C:\\evil;C:\\Users\\u\\bin", Path: "C:\\other" });
  assert.match(env.PATH!, /^C:\\Windows\\System32;C:\\Windows;/);
  assert.doesNotMatch(env.PATH!, /evil|Users/);
});

test("T10 H6 names match case-insensitively and missing ones are omitted rather than invented", () => {
  const env = workerEnvironment({ systemroot: "D:\\Win" });
  assert.equal(env.SystemRoot, "D:\\Win");
  assert.equal(env.ComSpec, undefined, "a variable the Host does not have is not invented");
  assert.equal(env.PATH, "D:\\Win\\System32;D:\\Win;D:\\Win\\System32\\Wbem;D:\\Win\\System32\\WindowsPowerShell\\v1.0");
});

test("T10 H6 the allowlist itself holds no secret-shaped name", () => {
  for (const name of WORKER_ENV_ALLOWLIST) assert.doesNotMatch(name, SECRET_NAMES, name);
  assert.ok(WORKER_ENV_ALLOWLIST.includes("SystemRoot"));
});
