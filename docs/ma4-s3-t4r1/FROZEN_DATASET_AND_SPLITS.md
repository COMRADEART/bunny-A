# MA4-S3-T4R1 Frozen Benchmark Dataset & Splits

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4R1  
**Dataset Size:** 60 Frozen Tasks (30 Development, 30 Held-Out Evaluation)  
**Model:** `qwen2.5-coder:7b` (`dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364`)  

---

## 1. Dataset Composition & Complexity Distribution

The evaluation dataset comprises 60 tasks categorized across four complexity classes (C0 to C3):

| Task Class | Category | Description | Tool Requirements | Development (30) | Held-Out (30) | Total Tasks |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| **C0** | `direct` | Direct prompt execution, pure function synthesis, arithmetic, formatting | 0 Tools | 8 | 7 | **15** |
| **C1** | `single-resource` | Grounded extraction, configuration parsing, error lookup | 1 Tool (`file.read`) | 7 | 8 | **15** |
| **C2** | `multi-resource` | Multi-file comparative analysis, schema migration, multi-step code generation | 2 Tools | 8 | 7 | **15** |
| **C3** | `complex-workflow`| Multi-agent synthesis, test verification, bounded repair, adversarial checks | 3+ Tools (`test`, `review`) | 7 | 8 | **15** |
| **Total** | — | — | — | **30** | **30** | **60** |

---

## 2. Split Partitioning & Anti-Contamination Rules

1. **Development Set (Tasks 1–30):**
   - Used for calibration of adaptive planner heuristics, DAG deduplication rules, and initial memory seeding.
   - Verified experiences harvested from development tasks are stored with signature `sig:C1:single-resource` or `sig:C2:multi-resource`.

2. **Held-Out Evaluation Set (Tasks 31–60):**
   - Strictly reserved for blind paired testing.
   - **Zero Leakage Invariant:** The verified experience memory is **never** permitted to ingest held-out answers, test suites, or ground-truth references prior to the evaluation trial.
   - Baseline and Candidate evaluate held-out tasks under identical token, memory, and permission constraints.

---

## 3. Frozen Task Schema

Each task is defined as an immutable object conforming to:

```typescript
export type BenchmarkTask = {
  id: string;                      // Stable identifier (e.g. "DIR-01", "GND-02", "MUL-03", "WRK-04")
  name: string;                    // Human-readable task name
  category: "direct" | "single-resource" | "multi-resource" | "complex-workflow";
  taskClass: "C0" | "C1" | "C2" | "C3";
  split: "dev" | "held-out";
  prompt: string;                  // Exact user prompt
  referenceFiles?: Record<string, string>; // Files placed in bench-root/
  expectedPattern?: RegExp;        // Deterministic text oracle
  expectedOutputSubstring?: string;// Deterministic text oracle
  validator?: (output: string, files: Record<string, string>) => boolean;
  expectedTools?: string[];        // Expected capability grants
};
```

All 60 task inputs, reference files, and acceptance validators are frozen in `src/lib/bunny-host/ma4/live-benchmark.server.ts`.
