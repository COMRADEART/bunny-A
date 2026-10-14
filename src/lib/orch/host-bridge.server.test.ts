import test from "node:test";
import assert from "node:assert/strict";
import { authorizeBridge, mayClearLocalPairing } from "./host-bridge.server.ts";

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });
test("T13.2 preview recovery clears only a local stale pairing and never admits relayed or remote access", () => {
  const local = req("http://127.0.0.1:8080/api/bunny-pair", {
    cookie: "bunny_device=fixture",
    origin: "http://127.0.0.1:8080",
  });
  assert.equal(mayClearLocalPairing(local, "127.0.0.1"), true);
  assert.throws(() => authorizeBridge(local, "127.0.0.1"), /cannot use workstation/);
  assert.equal(mayClearLocalPairing(local, "192.168.1.50"), false);
  assert.equal(mayClearLocalPairing(local, undefined), false);
  assert.equal(
    mayClearLocalPairing(
      req("http://127.0.0.1:8080/api/bunny-pair", {
        cookie: "bunny_device=fixture",
        origin: "https://evil.invalid",
      }),
      "127.0.0.1",
    ),
    false,
  );
  assert.equal(
    mayClearLocalPairing(
      req("http://127.0.0.1:8080/api/bunny-pair", {
        cookie: "bunny_device=fixture",
        "x-forwarded-for": "1.2.3.4",
      }),
      "127.0.0.1",
    ),
    false,
  );
});

test("workstation access requires a loopback peer, not just a loopback Host header", () => {
  assert.deepEqual(authorizeBridge(req("http://127.0.0.1:8080/x"), "127.0.0.1"), {
    local: true,
    token: null,
  });
  assert.equal(authorizeBridge(req("http://localhost:8080/x"), "::1").local, true);
  assert.throws(
    () => authorizeBridge(req("http://127.0.0.1:8080/x"), "192.168.1.50"),
    /only available from this machine/,
  );
  assert.throws(
    () => authorizeBridge(req("http://127.0.0.1:8080/x"), undefined),
    /only available from this machine/,
  );
});
test("proxied requests cannot borrow workstation authentication", () => {
  const cases: Record<string, string>[] = [
    { "cf-connecting-ip": "1.2.3.4" },
    { "x-forwarded-for": "1.2.3.4" },
    { "x-forwarded-proto": "https" },
    { "x-real-ip": "1.2.3.4" },
  ];
  for (const headers of cases)
    assert.throws(
      () => authorizeBridge(req("http://127.0.0.1:8080/x", headers), "127.0.0.1"),
      /cannot use workstation/,
    );
});
test("non-loopback hosts never get workstation access", () => {
  delete process.env.BUNNY_REMOTE_ORIGIN;
  assert.throws(
    () => authorizeBridge(req("http://192.168.1.2:8080/x"), "127.0.0.1"),
    /not configured/,
  );
  process.env.BUNNY_REMOTE_ORIGIN = "https://bunny.example.com";
  assert.deepEqual(
    authorizeBridge(
      req("https://bunny.example.com/x", { cookie: "bunny_device=abc" }),
      "127.0.0.1",
    ),
    { local: false, token: "abc" },
  );
  delete process.env.BUNNY_REMOTE_ORIGIN;
});
