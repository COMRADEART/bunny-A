# MA4-S2-T5 — Windows Notch, Dashboard & Voice UX (`NOTCH_VOICE_UX.md`)

- **Gate T5-D Verdict:** **`PASS`**

---

## 1. Truthful Island / Notch Status Hierarchy

Implemented in [`src/components/island/journey-model.ts`](../../src/components/island/journey-model.ts) (`islandPresence`, `ISLAND_STATES`) and [`install/Bunny-Island.ps1`](../../install/Bunny-Island.ps1):

- **12 Explicit States (`ISLAND_STATES`):** `idle`, `listening`, `thinking`, `planning`, `working`, `multi`, `handoff`, `approval`, `streaming`, `completed`, `failed`, `offline`.
- **Priority Ordering:**
  1. `offline` (when Host connection is stale/disconnected — never claims work is running when disconnected)
  2. `approval` (when `pendingApprovals > 0` or `taskState === "approval"`)
  3. `listening` (when local voice capture is active)
  4. `handoff` / `streaming` / `multi` / `planning` / `thinking` / `working`
  5. `failed` / `completed` / `idle`
- **No Fabricated Progress or Authority:** `islandPresence` never invents percentages or ETAs, and monitoring is reported as `Monitoring N` rather than active model generation (`proactiveHeadline` in [`src/components/island/proactive-model.ts`](../../src/components/island/proactive-model.ts)).

---

## 2. Goal-Criterion Schedule Linking (`BLK-T3R1-03` Closure)

- Updated [`src/components/island/proactive-forms.ts`](../../src/components/island/proactive-forms.ts) (`ScheduleDraft`, `buildSchedule`) and [`src/components/island/proactive-create.tsx`](../../src/components/island/proactive-create.tsx) (`ScheduleForm`) so users can select **`Serves goal (optional)`** and **`Goal criterion`** when creating a task schedule.
- Validated in `T5-D` ([`src/lib/bunny-host/ma4-s2t5.test.ts`](../../src/lib/bunny-host/ma4-s2t5.test.ts)): produces `goal: { id, criterionId }` accepted by `ScheduleSpecSchema`, and surfaces a field-level accessible error (`"Choose the goal criterion this schedule serves."`) if a goal is chosen without a criterion.

---

## 3. Voice UX Fallback & Non-Blocking Behavior

- When the hash-pinned `whisper.cpp` runtime is staged (`scripts/stage-voice-runtime.ps1`), push-to-talk transitions cleanly `idle -> listening -> thinking`.
- When the voice runtime or microphone is absent, the voice control reports `unavailable` in place without blocking keyboard/mouse task submission, approvals, or navigation.
