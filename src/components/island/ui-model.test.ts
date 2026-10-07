import test from "node:test";
import assert from "node:assert/strict";
import {
  bytes,
  elapsed,
  finitePlan,
  isLocalGeneration,
  percent,
  recentSamples,
  thermalReadingFor,
  verifiedFile,
  conflictsWithLocalOnly,
  PROVIDER_DEFAULT_MODEL,
  routingFacts,
} from "./ui-model.ts";
import type { HostSample, OrchTask, RouteDecision, TaskProgress } from "../../lib/orch/types.ts";

const task = (fields: Partial<OrchTask>) => fields as OrchTask;
const decision = (fields: object) => fields as unknown as RouteDecision;
const sample = (at: number, temperatureC: number | null = null): HostSample => ({
  at,
  cpu: { utilization: null, clockMhz: null, temperatureC },
  memory: { usedBytes: 0, availableBytes: 0, totalBytes: 0 },
  gpus: [],
  notes: [],
});

test("progress needs finite integer steps, never elapsed time or a provider percentage", () => {
  assert.equal(finitePlan({ kind: "indeterminate" }), null);
  assert.equal(finitePlan(null), null);
  for (const [completed, total] of [
    [0, 0],
    [1, Infinity],
    [NaN, 5],
    [-1, 5],
    [6, 5],
    [1.2, 5],
    [1, 5.2],
  ]) {
    assert.equal(
      finitePlan({ kind: "determinate", completed, total, source: "provider plan" }),
      null,
    );
  }
  const realPlan: TaskProgress = {
    kind: "determinate",
    completed: 7,
    total: 10,
    source: "provider plan",
    current: "Running tests",
  };
  assert.deepEqual(finitePlan(realPlan), realPlan);
});
test("elapsed uses actual session boundaries and freezes at finish", () => {
  assert.equal(elapsed(task({ startedAt: null }), 999999), "—");
  assert.equal(elapsed(task({ startedAt: 1000 }), 259000), "04:18");
  assert.equal(elapsed(task({ startedAt: 1000, finishedAt: 259000 }), 999999), "04:18");
  assert.equal(elapsed(task({ startedAt: 1000 }), 3662000), "1:01:01");
});
test("missing sensors remain unavailable and gaps remain in telemetry history", () => {
  for (const value of [null, undefined, NaN, Infinity]) {
    assert.equal(bytes(value), "Unavailable");
    assert.equal(percent(value), "Unavailable");
  }
  const history = [sample(100), sample(1000), sample(5000), sample(121000)];
  assert.deepEqual(recentSamples(history), history.slice(1));
  assert.equal(recentSamples(history)[1].cpu.utilization, null);
});
test("thermal warnings require fresh measured temperatures and a reachable Host", () => {
  assert.equal(thermalReadingFor([sample(1000, 95)], "offline", 90, 85, 2000), null);
  assert.equal(thermalReadingFor([sample(1000, 95)], "online", 90, 85, 20000), null);
  assert.equal(thermalReadingFor([sample(2000, 95)], "online", 90, 85, 1000), null);
  assert.equal(thermalReadingFor([sample(1000)], "online", 90, 85, 2000), null);
  assert.deepEqual(thermalReadingFor([sample(1000, 95)], "online", 90, 85, 2000), {
    name: "CPU",
    temperature: 95,
    key: "cpu",
  });
});
test("cloud and unknown Ollama models cannot be presented as local inference", () => {
  assert.equal(
    isLocalGeneration(task({ provider: "ollama", model: "deepseek:cloud", state: "running" })),
    false,
  );
  assert.equal(isLocalGeneration(task({ provider: "ollama", model: "", state: "running" })), false);
  assert.equal(
    isLocalGeneration(task({ provider: "ollama", model: "qwen3:8b", state: "completed" })),
    false,
  );
  assert.equal(
    isLocalGeneration(task({ provider: "ollama", model: "qwen3:8b", state: "running" })),
    true,
  );
  assert.equal(
    conflictsWithLocalOnly(
      task({ provider: "ollama", model: "deepseek:cloud", constraints: { localOnly: true } }),
    ),
    true,
  );
  assert.equal(
    conflictsWithLocalOnly(
      task({ provider: "ollama", model: "deepseek:cloud", constraints: { localOnly: false } }),
    ),
    false,
  );
});
test("a file claim requires independent Host verification; prose never creates a file manifest", () => {
  assert.equal(verifiedFile(task({ state: "completed", output: "report.pdf created" })), null);
  const fields: Partial<OrchTask> = {
    state: "completed",
    cwd: "C:\\Projects\\bunny",
    verify: { kind: "file", name: "result.txt", expected: "OK" },
  };
  assert.equal(verifiedFile(task(fields)), null);
  assert.equal(
    verifiedFile(task({ ...fields, verification: { passed: false, detail: "Missing" } })),
    null,
  );
  assert.deepEqual(
    verifiedFile(task({ ...fields, verification: { passed: true, detail: "Disk check" } })),
    { name: "result.txt", folder: "C:\\Projects\\bunny", path: "C:\\Projects\\bunny\\result.txt" },
  );
});
test("routing facts show auto/manual, provider defaults and candidate counts without inventing availability", () => {
  // A T3-engaged AUTO task: exact model Unknown when the pick is the provider default.
  assert.deepEqual(
    routingFacts(
      task({
        routingMode: "auto",
        model: "auto",
        effort: null,
        routingRerouted: false,
        decision: decision({
          policy_version: "routing-policy-v1",
          routing_mode: "auto",
          candidate_count: 5,
          eligible_candidate_count: 2,
          reroutes: 0,
        }),
      }),
    ),
    {
      engaged: true,
      mode: "Auto",
      model: PROVIDER_DEFAULT_MODEL,
      effort: null,
      candidates: "2 eligible of 5 considered",
      rerouted: false,
    },
  );
  assert.equal(routingFacts(task({ routingMode: "manual", model: "qwen3:8b", decision: decision({ policy_version: "routing-policy-v1", candidate_count: 5, eligible_candidate_count: 2 }) })).mode, "Manual");
  // Legacy tasks: no policy_version, no routingMode → not engaged, honest "Model unavailable".
  const legacy = routingFacts(task({ model: "" }));
  assert.equal(legacy.engaged, false);
  assert.equal(legacy.mode, null);
  assert.equal(legacy.candidates, null);
  assert.equal(legacy.model, "Model unavailable");
  // A known exact model wins over the default text on both paths.
  assert.equal(routingFacts(task({ model: "qwen3:8b" })).model, "qwen3:8b");
  assert.equal(routingFacts(task({ routingMode: "auto", model: "qwen3:8b", decision: decision({ policy_version: "routing-policy-v1" }) })).model, "qwen3:8b");
});
test("rerouted reflects live reroute truth; unknown stays unknown for legacy tasks", () => {
  assert.equal(routingFacts(task({ routingMode: "auto", routingRerouted: true, decision: decision({ policy_version: "routing-policy-v1" }) })).rerouted, true);
  assert.equal(routingFacts(task({ routingMode: "auto", decision: decision({ policy_version: "routing-policy-v1", reroutes: 3 }) })).rerouted, true);
  assert.equal(routingFacts(task({ routingMode: "auto", decision: decision({ policy_version: "routing-policy-v1" }) })).rerouted, false);
  assert.equal(routingFacts(task({})).rerouted, null);
});
