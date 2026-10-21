import { writeFileSync } from 'node:fs';
import { teamSetup, createTeam, missionOf, reachReview } from '../../src/lib/bunny-host/agent-team.fixture.ts';
const env = await teamSetup('s1r-fixture-probe');
try {
  const ids = createTeam(env);
  if (process.argv.includes('--after-fix')) await reachReview(env, ids.coordinatorId, ids.missionId);
  else { env.agents.start(ids.coordinatorId,'workstation'); await new Promise(r=>setTimeout(r,1000)); }
  const m=missionOf(env,ids.missionId);
  const record={phase:process.argv.includes('--after-fix')?'after fixture metadata correction':'before fixture metadata correction',state:m.state,
    steps:m.steps.map(s=>({role:s.role,state:s.state,failure:s.failure?.detail??null})),modelFacts:env.tasks.modelCapabilities.list().map(m=>({model:m.model,contextWindow:m.contextWindow,local:m.local}))};
  writeFileSync(`docs/ma4-s1r/evidence/team-fixture-${process.argv.includes('--after-fix')?'fixed':'reproduction'}.json`,JSON.stringify(record,null,2)+'\n');
  console.log(JSON.stringify(record));
} finally { await env.cleanup(); }
