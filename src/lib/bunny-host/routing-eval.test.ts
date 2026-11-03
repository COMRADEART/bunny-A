import test from "node:test";
import assert from "node:assert/strict";
import { runRoutingEval, routingEvalDigest, ROUTING_EVAL_SET, evalProvider, type EvalRow } from "./routing-eval.ts";

test("the committed routing evaluation set holds every routing law against the real router", () => {
  const rows = runRoutingEval();
  assert.equal(rows.length, ROUTING_EVAL_SET.length, "every case is evaluated");
  const digest = routingEvalDigest(rows);
  assert.match(digest, /^Routing evaluation: \d+\/\d+/);
  // The committed set is a routing regression: any row that stops matching the law fails the gate, with its got text.
  assert.deepEqual(digest, `Routing evaluation: ${rows.length}/${rows.length} cases hold the routing law.`, digest);
});

test("the evaluation reports a failing case with its got; the runner is injectable for replay", () => {
  const rows = runRoutingEval(
    [
      {
        name: "law violation demo",
        law: "MA1: a local-only task must never run the cloud-hosted default",
        prompt: "Summarize hello",
        mode: "fast",
        providers: [evalProvider("ollama")],
        constraints: { localOnly: true },
        expect: { pick: { provider: "ollama" as never, model: "qwen2.5-coder:7b" as never } },
      },
    ],
    // An injected (regressed) router that invents a pick: the row reports verdict fail with the router's got, verbatim.
    () => ({ recommended_provider: "invented", recommended_model: "invented-model", eligible_providers: ["invented"] }),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.verdict, "fail");
  assert.match(rows[0]!.got, /picked invented/);
});