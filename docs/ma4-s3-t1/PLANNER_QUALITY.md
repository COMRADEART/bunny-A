# Planner quality

The existing typed plan and Host validation stay in place. T1 does not let a class label add tools.

What changed is who is invited:

- C0 does not call a planner to rephrase a question.
- C1 does not call a planner for a single read.
- C2 uses Planner and Worker.
- C3 uses those two plus Reviewer.

`task-intelligence.ts` still builds the four-node coding graph when the task is an explicit code-and-test contract. Shrinking that graph would drop the Tester the contract asks for. T1 leaves it.

No new live planning-quality score was collected. The structural claim is the role list above, checked by `composeTeam()`.
