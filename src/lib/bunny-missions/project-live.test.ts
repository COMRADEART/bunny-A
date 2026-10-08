import test from "node:test";
import assert from "node:assert/strict";
import { fork, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { AgentSnapshot } from "../bunny-host/agent-types.ts";
import type { ProjectDetail, RegisteredProject, ProjectPage } from "../bunny-host/project-types.ts";
import { contained } from "../bunny-host/project-paths.server.ts";
import { DatabaseSync } from "node:sqlite";
const evidence = resolve("test-results/ma3/t7");
const save = (name: string, value: unknown) => {
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + "\n");
};
async function start(data: string, workspace: string) {
  const allocator = createServer();
  await new Promise<void>((done) => allocator.listen(0, "127.0.0.1", done));
  const port = (allocator.address() as { port: number }).port;
  await new Promise<void>((done) => allocator.close(() => done()));
  const child = fork(
    resolve("scripts/fixtures/project-host-worker.mjs"),
    [data, workspace, String(port)],
    {
      execArgv: ["--experimental-strip-types"],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    },
  );
  let output = "";
  child.stdout?.on("data", (body) => {
    output += body;
  });
  child.stderr?.on("data", (body) => {
    output += body;
  });
  const ready = await new Promise<{ token: string; pid: number; generation: string }>(
    (done, reject) => {
      const timer = setTimeout(() => reject(Error(output || "Host timeout")), 30000);
      child.once("message", (value) => {
        clearTimeout(timer);
        done(value as { token: string; pid: number; generation: string });
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(Error(output));
      });
    },
  );
  const api = async (action: string, data: unknown = {}, status = 200) => {
    const response = await fetch(`http://127.0.0.1:${port}/command`, {
      method: "POST",
      headers: { authorization: `Bearer ${ready.token}`, "content-type": "application/json" },
      body: JSON.stringify({ action, data }),
    });
    const body = (await response.json()) as {
      data?: unknown;
      agents?: AgentSnapshot;
      error?: string;
    };
    assert.equal(response.status, status, `${action}: ${body.error}`);
    return body;
  };
  const state = async () =>
    (await (
      await fetch(`http://127.0.0.1:${port}/state`, {
        headers: { authorization: `Bearer ${ready.token}` },
      })
    ).json()) as { agents: AgentSnapshot };
  const stop = async () => {
    if (child.exitCode !== null) return;
    const ended = new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(Error("Disposable Host did not stop")), 20000);
      child.once("exit", () => {
        clearTimeout(timer);
        done();
      });
    });
    child.send("close");
    await ended;
  };
  return { api, state, stop, pid: ready.pid, generation: ready.generation, output: () => output };
}
const compare = (path: string, content: string) => ({
  kind: "capability",
  action: "filesystem.compare",
  params: { path, content },
  expect: { field: "matches", equals: true },
});
const step = (
  role: string,
  action: string,
  params: Record<string, unknown>,
  index: number,
  verification: unknown[],
) => ({
  role,
  objective: role,
  access: action === "filesystem.write" ? "write" : "read",
  executor: { kind: "capability", action, params },
  dependsOn: index ? [index - 1] : [],
  verification,
  crossApp: true,
});

test(
  "T7 P04/P22/P41/P42/P43/P44/P45/P46/P59: real Project Mission and fresh Windows Host preserve identities and verified effects",
  { timeout: 120000 },
  async () => {
    assert.equal(process.platform, "win32");
    const parent = mkdtempSync(join(tmpdir(), "bunny-t7-live-"));
    const data = join(parent, "state"),
      workspace = join(parent, "workspace"),
      a = join(parent, "project-a"),
      b = join(parent, "project-b");
    for (const folder of [data, workspace, a, b]) mkdirSync(folder);
    writeFileSync(join(a, "instruction.txt"), "T7 approved result\n");
    writeFileSync(join(a, "result.txt"), "before\n");
    writeFileSync(
      join(a, "check.mjs"),
      "import {readFileSync} from 'node:fs'; import assert from 'node:assert/strict'; assert.equal(readFileSync('result.txt','utf8'),'T7 approved result\\n'); console.log('T7 CHECK PASS');",
    );
    writeFileSync(join(b, "private.txt"), "Project B fixture-private material");
    for (const folder of [a, b]) {
      execFileSync("git", ["init"], { cwd: folder, windowsHide: true });
      execFileSync("git", ["add", "--", "."], { cwd: folder, windowsHide: true });
      execFileSync(
        "git",
        [
          "-c",
          "user.name=T7 fixture",
          "-c",
          "user.email=t7@example.invalid",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "-m",
          "Fixture",
        ],
        { cwd: folder, windowsHide: true },
      );
    }
    let host = await start(data, workspace);
    let completed = false;
    try {
      const first = { pid: host.pid, generation: host.generation };
      const projectA = (await host.api("project.add", { name: "Sample application", path: a }))
        .data as RegisteredProject;
      const projectB = (await host.api("project.add", { name: "Private repository", path: b }))
        .data as RegisteredProject;
      assert.equal(readFileSync(join(a, "result.txt"), "utf8"), "before\n");
      await host.api("project.update", {
        id: projectA.id,
        revision: projectA.revision,
        favorite: true,
        tags: ["application"],
      });
      const listing = (
        await host.api("project.list", { search: "application", filter: "favorites", sort: "name" })
      ).data as ProjectPage;
      assert.equal(listing.projects[0].id, projectA.id);
      await host.api("mission.configure", { enabled: true });
      const created = await host.api("agent.create", {
        projectId: projectA.id,
        name: "Project acceptance Agent",
        objective: "Inspect, edit, test and retain verified output",
        steps: [
          step("Inspect", "filesystem.read", { path: "instruction.txt" }, 0, [
            compare("instruction.txt", "T7 approved result\n"),
          ]),
          step("Repository", "git.status", {}, 1, [
            {
              kind: "capability",
              action: "git.status",
              params: {},
              expect: { field: "clean", equals: true },
            },
          ]),
          step(
            "Edit",
            "filesystem.write",
            { path: "result.txt", content: "T7 approved result\n", overwrite: true },
            2,
            [compare("result.txt", "T7 approved result\n")],
          ),
          step(
            "Check",
            "terminal.exec",
            { command: "node", args: ["check.mjs"], timeoutMs: 30000 },
            3,
            [{ kind: "capability_run", expectExit: 0, stdoutIncludes: "T7 CHECK PASS" }],
          ),
          step(
            "Report",
            "filesystem.write",
            { path: "report.txt", content: "T7 project verified." },
            4,
            [compare("report.txt", "T7 project verified.")],
          ),
        ],
      });
      const agent = created.agents!.agents[0];
      const proposal = await host.api("agent.authorization.propose", { id: agent.id });
      await host.api("agent.authorization.approve", {
        id: agent.id,
        revision: proposal.agents!.agents[0].authorization!.revision,
      });
      const deadline = Date.now() + 60000;
      let final: AgentSnapshot["agents"][number] | undefined;
      while (Date.now() < deadline) {
        final = (await host.state()).agents.agents.find((value) => value.id === agent.id);
        if (final?.state === "FAILED") throw Error(JSON.stringify(final));
        if (final?.state === "COMPLETED") break;
        await new Promise((done) => setTimeout(done, 50));
      }
      assert.equal(final?.state, "COMPLETED");
      const before = (await host.api("project.get", { id: projectA.id })).data as ProjectDetail;
      const other = (await host.api("project.get", { id: projectB.id })).data as ProjectDetail;
      assert.equal(before.agents[0].id, agent.id);
      assert.equal(before.missions[0].id, agent.missionId);
      assert.equal(before.artifacts.length > 0, true);
      assert.equal(other.artifacts.length, 0);
      assert.equal(other.agents.length, 0);
      const artifact = before.artifacts.find((value) => value.verification === "verified")!;
      const opened = await host.api("project.artifact", {
        projectId: projectA.id,
        artifactId: artifact.id,
      });
      assert.ok(opened.data);
      await host.api("project.artifact", { projectId: projectB.id, artifactId: artifact.id }, 400);
      const archived = (
        await host.api("project.update", {
          id: projectA.id,
          revision: before.project.revision,
          lifecycle: "ARCHIVED",
        })
      ).data as RegisteredProject;
      const restored = (
        await host.api("project.update", {
          id: projectA.id,
          revision: archived.revision,
          lifecycle: "ACTIVE",
        })
      ).data as RegisteredProject;
      assert.equal(restored.id, projectA.id);
      assert.equal(
        readFileSync(join(b, "private.txt"), "utf8"),
        "Project B fixture-private material",
      );
      await host.stop();
      host = await start(data, workspace);
      assert.notEqual(host.pid, first.pid);
      assert.notEqual(host.generation, first.generation);
      const after = (await host.api("project.get", { id: projectA.id })).data as ProjectDetail;
      assert.equal(after.project.id, before.project.id);
      assert.equal(after.agents[0].id, agent.id);
      assert.equal(after.agents[0].state, "COMPLETED");
      assert.equal(after.missions[0].id, before.missions[0].id);
      assert.equal(after.missions[0].state, "completed");
      assert.deepEqual(after.workspaces, before.workspaces);
      assert.deepEqual(
        after.artifacts.map((value) => value.id),
        before.artifacts.map((value) => value.id),
      );
      await host.api(
        "agent.authorization.approve",
        { id: agent.id, revision: proposal.agents!.agents[0].authorization!.revision },
        400,
      );
      const db = new DatabaseSync(join(data, "host.sqlite"), { readOnly: true });
      try {
        const rows = (table: string) =>
          (db.prepare(`SELECT record FROM ${table}`).all() as { record: string }[]).map((row) =>
            JSON.parse(row.record),
          );
        const runs = rows("capability_runs");
        assert.equal(runs.filter((row) => row.action === "filesystem.write").length, 2);
        assert.equal(runs.filter((row) => row.action === "terminal.exec").length, 1);
        const contexts = rows("project_context_snapshots");
        assert.equal(contexts.length, 5);
        assert.ok(contexts.every((row) => row.projectId === projectA.id));
        save("integrated-project-mission.json", {
          classification: "DISPOSABLE LIVE VERIFIED",
          modelPlanning: "NOT TESTED; deterministic preauthored Mission",
          modelExecution: "NOT TESTED; zero model calls",
          accepted: true,
          projectA,
          projectB,
          agentId: agent.id,
          missionId: agent.missionId,
          steps: rows("mission_steps"),
          runs,
          before,
          after,
          privateProjectUnchanged: true,
          artifactsOpenedWithHashCheck: true,
          crossProjectArtifactDenied: true,
        });
        save("restart-recovery.json", {
          classification: "DISPOSABLE LIVE VERIFIED",
          first,
          fresh: { pid: host.pid, generation: host.generation },
          sameProject: true,
          sameAgent: true,
          sameMission: true,
          sameWorkspace: true,
          completedStayedCompleted: true,
          duplicateSideEffects: 0,
          staleConsentRefused: true,
          checkpoints: rows("agent_checkpoints"),
        });
        save("project-context-provenance.json", {
          classification: "DISPOSABLE LIVE VERIFIED",
          contexts,
        });
      } finally {
        db.close();
      }
      completed = true;
    } finally {
      save("live-attempt.json", { completed, output: host.output() });
      await host.stop();
      assert.ok(contained(resolve(tmpdir()), parent) && parent.includes("bunny-t7-live-"));
      rmSync(parent, { recursive: true, force: true });
    }
  },
);
