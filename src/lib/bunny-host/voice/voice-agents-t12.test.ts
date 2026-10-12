import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "../http.server.ts";
import { missionCommand } from "../../bunny-missions/commands.server.ts";

// M-A-3 T12: the canonical Mission path that the voice agents port calls (draftMission, missionStop). A spoken draft must
// be the same reviewed Mission the workstation screen shows: created by mission.create, waiting for review, never started.

test("T12 wiring: a voice draft is a canonical mission.create that waits for review and is never started", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t12-voice-agents-"));
  const host = await startHost({ dataDirectory: directory, root: directory, port: 45317 });
  try {
    // Missions are off by default: a draft is refused and nothing is created.
    await assert.rejects(
      missionCommand(host.missions, "mission.create", { objective: "Write release notes for the dashboard", mode: "fast", localOnly: true, projectId: null }, { local: true, actor: "voice:workstation" }),
      /disabled/i,
    );
    assert.equal(host.missions.snapshot().missions.length, 0);

    host.missions.configure({ enabled: true }, "test");
    const { mission } = await missionCommand(host.missions, "mission.create", { objective: "Write release notes for the dashboard", mode: "fast", localOnly: true, projectId: null }, { local: true, actor: "voice:workstation" });
    const view = mission as { id: string; title: string; state: string; origin: string };
    assert.equal(view.origin, "voice:workstation", "the draft is attributed to the voice origin, so it can be counted");
    assert.equal(view.state, "waiting_for_approval", "the draft waits for the workstation review; it never auto-starts");
    assert.equal(host.missions.store.mission(view.id).state, "waiting_for_approval");
    assert.equal(host.missions.store.mission(view.id).startedAt, null, "the draft has never started");

    // The voice stop path is the canonical mission.stop, which ends the draft.
    await missionCommand(host.missions, "mission.stop", { id: view.id }, { local: true, actor: "workstation" });
    assert.equal(host.missions.store.mission(view.id).state, "stopped");
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
