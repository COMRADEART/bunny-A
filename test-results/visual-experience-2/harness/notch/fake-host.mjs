// Visual Experience 2.0: copied from test-results/ma3/t13/notch/fake-host.mjs; adds the Host's real uiTheme view (argv 6-8).
// M-A-3 T13 notch evidence: a DISPOSABLE test double for the Host, never production.
// Serves the routes the Island reads (GET /state, POST /command) on 127.0.0.1 with a fake token, on ports 43800-43899 only.
// Every personal-agent record and voice variant below is a labeled FIXTURE (fixture: true); nothing here is user data.
// Usage: node fake-host.mjs <port> <voiceMode> <commandLogPath> <scenario>
//   voiceMode: idle | listening | speaking | both | approval | muted
//   scenario:  none | all-active | single | paused | verified | failed
import http from 'node:http';
import { appendFileSync } from 'node:fs';
import { DEFAULT_UI_PREFERENCE, uiThemeView } from '../../../../src/lib/bunny-host/ui-theme.ts';

const port = Number(process.argv[2]);
const mode = process.argv[3] || 'idle';
const logPath = process.argv[4] || '';
const scenario = process.argv[5] || 'none';
const uiThemeId = process.argv[6] || 'glass';
const uiVariant = process.argv[7] || 'dark';
const uiHighContrast = process.argv[8] === 'hc';
// argv 9 (optional): the stored revision. 0 = the owner never saved a workstation theme (independent review finding 1).
const uiRevision = Number(process.argv[9] ?? 1);
// The exact view the real Host sends (src/lib/bunny-host/ui-theme.ts), so the Notch validates real data.
const uiTheme = uiThemeView({ ...DEFAULT_UI_PREFERENCE, theme: uiThemeId, variant: uiVariant, highContrast: uiHighContrast }, uiRevision);
if (!(port >= 43800 && port <= 43899)) { console.error('port must be 43800-43899'); process.exit(2); }
const token = 'notch-fake-token';
const HOST_EPOCH = 'notch-fixture';

const COMPANION = {
  idle: { state: 'READY', reason: 'fixture: session idle' },
  listening: { state: 'LISTENING', reason: 'fixture: microphone open' },
  speaking: { state: 'SPEAKING', reason: 'fixture: playback confirmed' },
  both: { state: 'LISTENING_WHILE_SPEAKING', reason: 'fixture: capture and playback' },
  approval: { state: 'PERMISSION', reason: 'fixture: proposal waiting' },
  muted: { state: 'MUTED', reason: 'fixture: microphone muted' },
};

function voiceSnapshot() {
  const now = Date.now();
  const base = {
    protocol: 'bunny-voice/1', open: true, sessionId: 'notch-fixture', hostEpoch: HOST_EPOCH, principal: 'workstation',
    mode: 'push_to_talk', state: 'IDLE', capturing: false, playing: false, muted: false, outputHeld: false,
    level: null, turnId: null, generation: 1, partial: null, finalTranscript: null, turnKind: null,
    answer: null, answerSource: null, route: null, proposal: null, clarification: null, uiIntent: null,
    devices: { input: { name: 'Microphone', muted: false, volume: 0.5, present: true }, output: null, micPrivacy: 'allow' },
    engines: { stt: 'windows-speech', tts: 'windows-sapi', local: true }, error: null, lastInterrupt: null, lastBargeIn: null,
    duplex: null, timing: null, revision: 7, companion: { ...(COMPANION[mode] || COMPANION.idle), since: now, fixture: true }, createdAt: now, updatedAt: now,
  };
  if (mode === 'listening') {
    Object.assign(base, { state: 'LISTENING', capturing: true, partial: 'fixture draft text', level: { rms: 0.34, peak: 0.6, speech: true, at: now } });
  } else if (mode === 'speaking') {
    Object.assign(base, { state: 'SPEAKING', playing: true, finalTranscript: 'fixture: status please', answer: 'Fixture answer: the coding agent is working.' });
  } else if (mode === 'both') {
    Object.assign(base, { state: 'LISTENING', capturing: true, playing: true, level: { rms: 0.2, peak: 0.4, speech: true, at: now } });
  } else if (mode === 'approval') {
    Object.assign(base, { proposal: { id: 'fixture-p1', action: 'agent.pause', agentId: 'fixture-a1', agentName: 'Fixture agent', revision: 1, confirmVia: 'voice_or_screen', createdAt: now, expiresAt: now + 60000, hostEpoch: HOST_EPOCH } });
  } else if (mode === 'muted') {
    Object.assign(base, { state: 'MUTED', muted: true });
  }
  return base;
}

// FIXTURE personal agents: four slots in assorted states. Internal team members and unslotted Agents only appear as counts.
function slot(slotId, weapon, displayName, agentId, agentName, state, label, basis, extra = {}) {
  const bound = agentId !== null;
  return {
    slot: slotId, weapon, displayName, description: '', purpose: '', style: 'concise', responsibilities: [], agentId, active: true,
    agent: bound ? { id: agentId, name: agentName, state, missionId: 'fixture-m1', missionTitle: 'Fixture mission', objective: null, projectId: null, failure: extra.failure || null, team: false, updatedAt: Date.now() } : null,
    presentation: { state: bound ? label.state : 'UNASSIGNED', label: bound ? label.text : 'Not assigned', basis: bound ? basis : { kind: 'unassigned' } },
    attention: { pendingApprovals: extra.pending || 0 },
    progress: bound && extra.progress ? extra.progress : null,
    result: null,
    technical: bound && extra.model ? { provider: 'fixture-provider', model: extra.model, taskId: 'fixture-task' } : null,
  };
}

function personalAgents() {
  const now = Date.now();
  const coding = { state: 'CODING', text: 'Coding' };
  const research = { state: 'RESEARCHING', text: 'Researching' };
  const testing = { state: 'TESTING', text: 'Testing' };
  const waiting = { state: 'WAITING_FOR_USER', text: 'Needs you' };
  const idle = { state: 'IDLE', text: 'Ready to start' };
  const none = (slotId, weapon, displayName) => slot(slotId, weapon, displayName, null, '', 'CREATED', { state: 'UNASSIGNED', text: 'Not assigned' }, null);
  const all = [
    slot(1, 'gada', 'Build desk', 'fixture-a1', 'Build desk (fixture)', 'RUNNING', coding, { kind: 'provider-event', event: 'agent.editing', at: now, taskId: 'fixture-task' }, { progress: { completed: 2, total: 5, verified: 1 }, model: 'fixture-model-7b', pending: 0 }),
    slot(2, 'spear', 'Research desk', 'fixture-a2', 'Research desk (fixture)', 'RUNNING', research, { kind: 'capability', action: 'filesystem.read', stepId: 'fixture-s2' }, { progress: { completed: 1, total: 4, verified: 0 } }),
    slot(3, 'chakra', 'Release checks', 'fixture-a3', 'Release checks (fixture)', 'VERIFYING', testing, { kind: 'command', classified: 'agent.testing', stepId: 'fixture-s3' }, { progress: { completed: 3, total: 3, verified: 2 } }),
    slot(4, 'sword', 'Inbox triage', 'fixture-a4', 'Inbox triage (fixture)', 'WAITING_FOR_USER', waiting, { kind: 'agent-state', agentState: 'WAITING_FOR_USER' }, { pending: 2 }),
  ];
  if (scenario === 'all-active') return { slots: all };
  if (scenario === 'single') return { slots: [all[0], none(2, 'spear', 'Research desk'), none(3, 'chakra', 'Release checks'), none(4, 'sword', 'Inbox triage')] };
  if (scenario === 'paused') {
    const paused = slot(1, 'gada', 'Build desk', 'fixture-a1', 'Build desk (fixture)', 'PAUSED', { state: 'PAUSED', text: 'Paused' }, { kind: 'agent-state', agentState: 'PAUSED' }, { progress: { completed: 2, total: 5, verified: 1 } });
    return { slots: [paused, all[1], all[2], all[3]] };
  }
  if (scenario === 'verified') {
    const verified = slot(1, 'gada', 'Build desk', 'fixture-a1', 'Build desk (fixture)', 'COMPLETED', { state: 'VERIFIED', text: 'Completed and verified' }, { kind: 'mission-result', verifiedSteps: 5, unverifiedSteps: 0 }, { progress: { completed: 5, total: 5, verified: 5 } });
    return { slots: [verified, all[1], all[2], none(4, 'sword', 'Inbox triage')] };
  }
  if (scenario === 'failed') {
    const failed = slot(2, 'spear', 'Research desk', 'fixture-a2', 'Research desk (fixture)', 'FAILED', { state: 'FAILED', text: 'Failed' }, { kind: 'agent-state', agentState: 'FAILED' }, { failure: 'VERIFICATION_FAILED', progress: { completed: 2, total: 4, verified: 0 } });
    return { slots: [all[0], failed, all[2], none(4, 'sword', 'Inbox triage')] };
  }
  if (scenario === 'none') return { slots: [1, 2, 3, 4].map((id, i) => none(id, ['gada', 'spear', 'chakra', 'sword'][i], ['Build desk', 'Research desk', 'Release checks', 'Inbox triage'][i])) };
  return { slots: [] };
}

function state() {
  const pa = personalAgents();
  return {
    health: { operationalState: 'healthy', unavailableSubsystems: [] }, tasks: [], providers: [], projects: [{ id: 'fixture-project', name: 'Fixture project' }],
    agents: { agents: [] }, missions: { missions: [] }, samples: [], thermal: { gpuWarn: 90, cpuWarn: 90 },
    presentation: { tasks: [] }, remoteConfigured: false, voice: voiceSnapshot(), uiTheme,
    personalAgents: {
      fixture: true, schema: 'bunny-a.personal-agents.v1', revision: 3, updatedAt: Date.now(), slots: pa.slots,
      unslottedAgents: scenario === 'none' ? 0 : 2, bindable: [],
    },
  };
}

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer ' + token) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"unauthorized"}'); return; }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url === '/state') { res.end(JSON.stringify(state())); return; }
    if (req.method === 'POST' && req.url === '/command') {
      let action = '';
      let data = null;
      try { ({ action, data } = JSON.parse(body)); } catch { /* malformed: refused below */ }
      if (logPath) appendFileSync(logPath, JSON.stringify({ at: Date.now(), action, data }) + '\n');
      if (typeof action === 'string' && action.startsWith('voice.')) { res.end(JSON.stringify({ data: voiceSnapshot() })); return; }
      // Agent actions are refused by the fixture on purpose: the Island must show the refusal, never a success.
      res.writeHead(409, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'fixture host refuses agent commands' }));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
});
server.listen(port, '127.0.0.1', () => process.stderr.write('notch fixture host ' + mode + ' ' + scenario + ' on ' + port + '\n'));
