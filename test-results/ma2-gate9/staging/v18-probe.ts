import { getState, getMission, saveRecord } from './live-shared.ts';
import type { ApprovalBatch } from '../../../../src/lib/bunny-missions/types.ts';
const view = (await getState()).missions?.missions.find((mission) => mission.title === 'T9 v18 positive batch');
if (view) {
  const detail = await getMission(view.id);
  console.log(JSON.stringify({ id: view.id, state: view.state, requests: detail.mission.requests, runs: detail.runs.map((run) => ({ action: run.action, summary: run.summary, status: run.status })), events: detail.events.filter((event) => event.type.startsWith('approval.batch')) }, null, 2));
}
const { ComputerCapability } = await import(process.argv.includes('--source') ? 'file:///C:/Users/allam/Documents/new/bun-router/src/lib/bunny-missions/capabilities/computer.server.ts' : 'file:///C:/Users/allam/AppData/Local/Bunny-A-T9-stage/releases/Bunny-A-Windows-v19-T9/src/lib/bunny-missions/capabilities/computer.server.ts');
const adapter = new ComputerCapability('C:/Users/allam/AppData/Local/Bunny-A-T9-stage/state');
try {
  const identity = await adapter.prepareBatchAction('computer.focus_window', { title: 'Calculator' }, { expiresAt: Date.now() + 60_000 } as ApprovalBatch);
  console.log(JSON.stringify({ identity }));
} catch (error) { console.log(JSON.stringify({ targetValidationError: error instanceof Error ? error.message : String(error) })); }
const read = await adapter.execute('computer.read_controls', { title: 'Calculator', limit: 400 }, { missionId: null, stepId: null, cwd: 'C:/Users/allam/Bunny-Workspace-T9-stage', roots: [], dataDirectory: 'C:/Users/allam/AppData/Local/Bunny-A-T9-stage/state', signal: new AbortController().signal, timeoutMs: 30_000 });
const output = read.output as { window: unknown; controls: { controlType: string }[] };
console.log(JSON.stringify({ window: output.window, nestedWindows: output.controls.filter((control) => control.controlType === 'ControlType.Window') }));
