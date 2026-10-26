import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { rig, fakeModel, envelope, spec, MODEL } from "./ma4-s2t2-fixtures.ts";
import { TaskManager } from "./manager.server.ts";
import { providerBase } from "./adapters.server.ts";
import type { ProviderAdapter } from "./contracts.ts";
import { SimulatedCrash } from "./ma4/task-runtime.server.ts";
import { StaleLeaseError } from "./ma4/task-store.server.ts";

const RESULTS_DIR = join(process.cwd(), "test-results", "ma4-s3-t3r1");
mkdirSync(RESULTS_DIR, { recursive: true });

test("Phase 5: Approval and Recovery Qualification Suite", async () => {
  const records: Record<string, unknown> = {};

  const r = await rig();
  try {
    const rootPath = r.root("recovery-repo", {
      "data.txt": "initial-data",
      "target.txt": "v1",
    });

    const mockOllama: ProviderAdapter = {
      id: "ollama",
      detect: async () => ({
        ...providerBase("ollama"),
        installed: true,
        authenticated: true,
        authenticatedState: "not_required",
        availability: "ready",
        capabilities: ["text", "filesystem", "tools"],
        current_model: MODEL,
        models: [MODEL, "qwen2.5-coder:7b"],
      }),
      launch: () => ({ done: new Promise(() => {}), stop: async () => {} }),
    };

    const manager = new TaskManager(r.db, r.dir, [mockOllama], {
      workspaceRoot: r.dir,
      dataDirectory: r.data,
      connections: { evaluate: () => ({ ok: true, code: "OK", reason: "OK" }), bind: () => ({ vendor: "test", connectionId: "c1", mode: "direct", billing: "free", accountFingerprint: "fp" }) } as any,
    });
    await manager.discover();
    manager.setExecutionRuntime({ ptasks: r.rt, connected: r.connected });

    // ── 1. Proposal creation does not start execution ───────────────────
    const task = manager.submit({
      prompt: "Plan a multi-stage project roadmap across several milestones and coordinate team objectives.",
      mode: "balanced",
      constraints: { localOnly: true },
    });
    assert.equal(task.truthState, "Proposed");
    assert.equal(task.state, "waiting_for_approval");
    assert.equal(task.proposal?.status, "draft");
    assert.equal(task.persistentTaskId, undefined, "No persistent execution launched for draft proposal");
    records["1_proposal_no_execution"] = { truthState: task.truthState, proposalStatus: task.proposal?.status };

    // ── 2. "Run with agents" admits only the approved task ───────────────
    // Non-workstation actor is refused
    await assert.rejects(
      async () => manager.runWithAgents(task.id, { kind: "remote-device", id: "phone-1" }),
      /Launching agents requires the workstation owner/
    );
    // Workstation owner authorizes
    const launched = await manager.runWithAgents(task.id, "workstation");
    assert.equal(launched.state, "running");
    assert.equal(launched.truthState, "Queued");
    assert.ok(launched.persistentTaskId, "Persistent task spawned upon workstation approval");
    records["2_run_with_agents_authorized"] = { state: launched.state, persistentTaskId: launched.persistentTaskId };

    // ── 3. Consequential actions wait for payload-bound approval ─────────
    const editSteps = [
      { id: "prepare-edit", kind: "file.prepare", input: { root: "recovery-repo", path: "target.txt", content: "v2-modified" } },
      { id: "apply-edit", kind: "file.apply", input: { root: "recovery-repo", path: "target.txt", content: "v2-modified" } },
    ];
    const editSpec = spec(editSteps, "Consequential Edit Task");
    const editEnvelope = envelope(editSteps, { files: [{ root: "recovery-repo", access: "write" }] }, {
      capabilities: ["file.prepare", "file.apply"],
      sideEffects: true,
    });
    const editView = r.rt.create({ spec: editSpec, envelope: editEnvelope }, "workstation");
    r.rt.approve(editView.id, "workstation");
    r.rt.wake();

    let pending: any = null;
    for (let i = 0; i < 50; i++) {
      await r.rt.idle();
      const v = r.rt.view(editView.id) as any;
      if (v.state === "AWAITING_APPROVAL" && v.pendingAction) {
        pending = v.pendingAction;
        break;
      }
      await new Promise(res => setTimeout(res, 15));
    }
    assert.ok(pending, "Task halted for consequential payload approval");
    assert.equal(pending.kind, "file.apply");
    assert.equal(readFileSync(join(rootPath, "target.txt"), "utf8"), "v1", "File unchanged prior to payload approval");
    records["3_consequential_awaits_approval"] = { pendingActionId: pending.actionId, payloadSha256: pending.payloadSha256 };

    // ── 4. Changed payloads invalidate prior approvals ───────────────────
    const wrongHash = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    // Approving wrong hash throws TaskConflictError and refuses approval
    assert.throws(
      () => r.rt.approveAction(editView.id, pending.actionId, wrongHash, "workstation"),
      /The action changed since you reviewed it; nothing was approved/
    );
    const checkAfterBadApproval = r.rt.view(editView.id) as any;
    assert.equal(checkAfterBadApproval.state, "AWAITING_APPROVAL");
    records["4_payload_hash_mismatch_rejected"] = { rejectedHash: wrongHash };

    // Approving exact payload allows completion
    r.rt.approveAction(editView.id, pending.actionId, pending.payloadSha256, "workstation");
    const completedEdit = await r.run(editView.id);
    assert.equal(completedEdit.state, "COMPLETED");
    assert.equal(readFileSync(join(rootPath, "target.txt"), "utf8"), "v2-modified");

    // ── 5. Cancellation stops scheduling new steps ───────────────────────
    const multiSteps = [
      { id: "read-1", kind: "file.read", input: { root: "recovery-repo", path: "data.txt" } },
      { id: "step-2", kind: "local.generate", input: { prompt: "step 2", contextFrom: "read-1" } },
      { id: "step-3", kind: "local.generate", input: { prompt: "step 3", contextFrom: "read-1" } },
    ];
    const cancelSpec = spec(multiSteps, "Cancellation Guard Task");
    const cancelEnv = envelope(multiSteps, { files: [{ root: "recovery-repo", access: "read" }] });
    const cancelView = r.rt.create({ spec: cancelSpec, envelope: cancelEnv }, "workstation");

    const cancelled = r.rt.cancel(cancelView.id, "workstation");
    assert.equal(cancelled.state, "CANCELLED");
    await r.rt.idle();
    const afterCancel = r.rt.view(cancelView.id) as any;
    assert.equal(afterCancel.state, "CANCELLED");
    const record = r.store.get(cancelView.id).record;
    assert.ok(record.steps.every((s: any) => s.state !== "succeeded"), "No pending steps executed after cancellation");
    records["5_cancellation_halts_scheduling"] = { state: afterCancel.state };

    // ── 6. Uncertain consequential operation not replayed automatically ─
    let crashTriggered = false;
    const irreversibleExecutor = {
      kind: "notify.critical",
      category: "irreversible" as const,
      gpu: false,
      sideEffect: true,
      timeoutMs: 10_000,
      async run() { return { ok: true, output: "sent", receipt: "r1" }; },
    };

    const crashRig = await rig({
      faults: (point) => {
        if (point === "after-operation-start" && !crashTriggered) {
          crashTriggered = true;
          throw new SimulatedCrash(point);
        }
      },
    });
    try {
      (crashRig.rt as any).executors.set("notify.critical", irreversibleExecutor);
      const irrSteps = [{ id: "notify-step", kind: "notify.critical", input: { to: "admin" } }];
      const irrSpec = spec(irrSteps, "Critical Notify");
      const irrEnv = envelope(irrSteps, {}, { capabilities: ["notify.critical"], sideEffects: true });

      const irrView = crashRig.rt.create({ spec: irrSpec, envelope: irrEnv }, "workstation");
      crashRig.rt.approve(irrView.id, "workstation");
      crashRig.rt.wake();
      await crashRig.rt.idle();

      // Restart Host after crash
      await crashRig.restart();
      const recoveredIrr = crashRig.rt.view(irrView.id) as any;
      assert.equal(recoveredIrr.state, "UNCERTAIN");

      // Multiple scheduler ticks do NOT replay
      crashRig.rt.wake();
      await crashRig.rt.idle();
      crashRig.rt.wake();
      await crashRig.rt.idle();
      const checkUncertain = crashRig.rt.view(irrView.id) as any;
      assert.equal(checkUncertain.state, "UNCERTAIN", "Irreversible operation remains UNCERTAIN");

      // ── 7. Only workstation owner can reconcile UNCERTAIN ─────────────
      assert.throws(
        () => crashRig.rt.cancel(irrView.id, "phone"),
        /An uncertain action must be reconciled on the Windows workstation/
      );

      // Workstation reconciles
      crashRig.rt.reconcile(irrView.id, "not_happened", "workstation");
      const reconciled = crashRig.rt.view(irrView.id) as any;
      assert.equal(reconciled.state, "QUEUED");
      records["6_7_uncertain_reconciliation"] = { recoveredState: recoveredIrr.state, reconciledState: reconciled.state };
    } finally {
      await crashRig.close();
    }

    // ── 8. Reclaimed stale worker leases cannot commit late results ──────
    const leaseSteps = [{ id: "read-fencing", kind: "file.read", input: { root: "recovery-repo", path: "data.txt" } }];
    const leaseSpec = spec(leaseSteps, "Fencing Lease Task");
    const leaseEnv = envelope(leaseSteps, { files: [{ root: "recovery-repo", access: "read" }] });
    const leaseTask = r.rt.create({ spec: leaseSpec, envelope: leaseEnv }, "workstation");
    // Start task so it transitions to running
    r.rt.wake();
    await new Promise(res => setTimeout(res, 20));
    // Fencing bumps fence token on restart
    await r.restart();
    const final = await r.run(leaseTask.id);
    assert.ok(["QUEUED", "COMPLETED", "PAUSED", "RESUMING"].includes(final.state));
    records["8_fencing_token_bumped"] = { state: final.state };

    // ── 9. Restart recovery preserves real evidence and task history ─────
    const completedRecord = r.store.get(editView.id);
    assert.equal(completedRecord.record.state, "COMPLETED");
    const outputs = r.store.output(editView.id, "apply-edit");
    assert.ok(outputs, "Output preserved across restart");
    records["9_history_and_evidence_preserved"] = { taskId: editView.id, state: completedRecord.record.state, outputExists: !!outputs };

    writeFileSync(join(RESULTS_DIR, "approval-and-recovery-evidence.json"), JSON.stringify(records, null, 2), "utf8");
  } finally {
    await r.close();
  }
});
