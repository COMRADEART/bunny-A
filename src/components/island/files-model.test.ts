import test from "node:test";
import assert from "node:assert/strict";
import { artifactOpenState, artifactRows, bytesLabel, groupArtifacts, VERDICT_LABEL } from "./files-model.ts";

const artifact = (id: string, verification: string, createdAt: number, kind: "inline" | "file" = "file") =>
  ({
    id,
    missionId: "m1",
    stepId: null,
    type: "document",
    title: `Artifact ${id}`,
    location: kind === "file" ? { kind, path: `out/${id}.md`, mediaType: "text/markdown" } : { kind, mediaType: "application/json" },
    sha256: "a".repeat(64),
    bytes: 2048,
    createdAt,
    verification,
    consumers: [],
    provenance: "test",
  }) as never;

const missions = [
  { id: "m1", title: "Research", projectId: "p1", artifacts: [artifact("a1", "verified", 300), artifact("a2", "unverified", 100, "inline")] },
  { id: "m2", title: "Build", projectId: null, artifacts: [artifact("a3", "failed", 200)] },
] as never;

test("T13 files: every Mission artifact is a row, newest first, with its Mission and Project named", () => {
  const rows = artifactRows(missions, new Map([["p1", "Bunny router"]]));
  assert.deepEqual(rows.map((row) => row.id), ["a1", "a3", "a2"]);
  assert.equal(rows[0].projectName, "Bunny router");
  assert.equal(rows[0].missionTitle, "Research");
  assert.equal(rows[1].projectName, null, "a Mission with no Project names none");
  assert.equal(rows[2].location, "inline");
  assert.equal(rows[0].mediaType, "text/markdown");
});

test("T13 files: groups follow the Host's verdict; nothing unknown is called verified", () => {
  const groups = groupArtifacts(artifactRows(missions));
  assert.deepEqual(groups.verified.map((row) => row.id), ["a1"]);
  assert.deepEqual(groups.unverified.map((row) => row.id), ["a2"]);
  assert.deepEqual(groups.failed.map((row) => row.id), ["a3"]);
});

test("T13 files: an unrecognised verdict is unverified, never verified", () => {
  const rows = artifactRows([{ id: "m9", title: "x", projectId: null, artifacts: [artifact("z", "maybe", 1)] }] as never);
  assert.equal(rows[0].verification, "unverified");
  assert.equal(groupArtifacts(rows).verified.length, 0);
});

test("T13 files: opening is allowed only when online, verified and owned by a Project, and always says why not", () => {
  assert.deepEqual(artifactOpenState({ verification: "verified", projectId: "p1" }, true), { enabled: true, reason: null });
  assert.equal(artifactOpenState({ verification: "verified", projectId: "p1" }, false).enabled, false);
  assert.equal(artifactOpenState({ verification: "unverified", projectId: "p1" }, true).enabled, false);
  assert.match(artifactOpenState({ verification: "unverified", projectId: "p1" }, true).reason ?? "", /Not verified/);
  assert.match(artifactOpenState({ verification: "failed", projectId: "p1" }, false).reason ?? "", /Reconnect/);
});

test("T13 files: a verified file with no owning Project is never an enabled no-op", () => {
  const state = artifactOpenState({ verification: "verified", projectId: null }, true);
  assert.equal(state.enabled, false);
  assert.match(state.reason ?? "", /No Project owns/);
});

test("T13 files: verdict labels are the Host's words", () => {
  assert.equal(VERDICT_LABEL.verified, "Verified by Bunny-A");
  assert.equal(VERDICT_LABEL.unverified, "Not verified");
  assert.equal(VERDICT_LABEL.failed, "Verification failed");
});

test("T13 files: sizes read as bytes, KB and MB, and a bad number reads as unknown", () => {
  assert.equal(bytesLabel(512), "512 B");
  assert.equal(bytesLabel(2048), "2.0 KB");
  assert.equal(bytesLabel(40 * 1024), "40 KB");
  assert.equal(bytesLabel(3 * 1024 * 1024), "3.0 MB");
  assert.equal(bytesLabel(Number.NaN), "Size unknown");
  assert.equal(bytesLabel(-1), "Size unknown");
});

test("T13 files: an empty Host has no rows", () => {
  assert.deepEqual(artifactRows([]), []);
});
