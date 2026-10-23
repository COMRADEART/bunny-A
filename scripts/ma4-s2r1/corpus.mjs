// MA4-S2R1 evaluation corpus (docs/ma4-s2r1/NEW_BENCHMARK_PREREGISTRATION.md §2). The S2 evaluation database is
// opened READ-ONLY; every S2 skill record is copied unchanged (state, evidence, history) into a separate S2R1
// evaluation database outside the repository. Skills with passing sandbox evidence on their source task get a Host
// applicability attestation from that task's signature; the benchmark-qualified ones get a Lotus pointer, as in S2.
// Nothing is approved or activated, and the owner's real Host database is never opened.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { HostDatabase } from '../../src/lib/bunny-host/persistence.server.ts';
import { ExperienceMemory } from '../../src/lib/bunny-host/ma4/experience.server.ts';
import { SkillRegistry } from '../../src/lib/bunny-host/ma4/skills.server.ts';
import { attestApplicability, taskSignature } from '../../src/lib/bunny-host/ma4/relevance.ts';
import { S2_TASKS } from '../ma4-s2/eval-tasks.mjs';

export const SCOPE = 'project:ma4-s2r1-eval';
const base = join(process.env.LOCALAPPDATA ?? homedir(), 'Bunny-A');
export const S2_DB = join(base, 'ma4-s2-eval', 'eval.sqlite');
export const DB_PATH = join(base, 'ma4-s2r1-eval', 'eval.sqlite');

export function openCorpus(path = DB_PATH, now = Date.now()) {
  const db = new HostDatabase(path), registry = new SkillRegistry(db), memory = new ExperienceMemory(db);
  memory.setPolicy({ enabled: true, retentionDays: 30, persistRuns: true });
  const copied = [];
  if (!registry.list().length) {
    if (!existsSync(S2_DB)) throw new Error(`S2 evaluation database not found: ${S2_DB}`);
    const s2 = new DatabaseSync(S2_DB, { readOnly: true });
    const insert = db.db.prepare('INSERT INTO ma4_skills(id,name,version,state,record) VALUES(?,?,?,?,?)');
    for (const row of s2.prepare('SELECT id,name,version,state,record FROM ma4_skills ORDER BY name,version').all()) { insert.run(row.id, row.name, row.version, row.state, row.record); copied.push(`${row.name}@v${row.version}:${row.state}`); }
    s2.close();
    for (const skill of registry.list()) {
      const task = S2_TASKS.find(t => t.id === skill.provenance.taskId);
      if (!task || !skill.evidence.some(e => e.stage === 'sandbox' && e.passed && e.detail.startsWith(`${task.id}:`))) continue;
      registry.attest(skill.id, attestApplicability(skill, { taskId: task.id, signature: taskSignature(task, { projectScope: SCOPE }) }, now), now);
      if (skill.state === 'benchmark_qualified') memory.recordSkillPointer(SCOPE, registry.get(skill.id), 'synthetic', now);
    }
  }
  return { db, registry, memory, copied };
}
