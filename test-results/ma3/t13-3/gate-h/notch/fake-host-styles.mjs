// M-A-3 T13.3 Gate H native Notch evidence: a DISPOSABLE test double for the Host, never production.
// Serves GET /state and POST /command on 127.0.0.1 with a fake token, on ports 43920-43959 only. Every record is a labeled
// FIXTURE. Adds what Gate H draws: characterAppearance (per-slot style) and personalAgentContext.foreground (the speaker).
// Usage: node fake-host-styles.mjs <port> <scenario> <appearanceJson> <foreground> <commandLogPath>
//   scenario:   speaker (Gada idle and speaking, Spear and Chakra working, Sword waiting for you) | all-working | all-idle
//   appearance: path to a JSON array of four { style, intensity, highContrast } (slot order), or "signature"
//   foreground: bunny | 1 | 2 | 3 | 4
import http from 'node:http';
import { appendFileSync, readFileSync } from 'node:fs';

const port = Number(process.argv[2]);
const scenario = process.argv[3] || 'speaker';
const appearanceArg = process.argv[4] || 'signature';
const foregroundArg = process.argv[5] || 'bunny';
const logPath = process.argv[6] || '';
if (!(port >= 43920 && port <= 43959)) { console.error('port must be 43920-43959'); process.exit(2); }
const token = 'gate-h-fake-token';
const signature = { style: null, intensity: 'full', highContrast: false };
const appearances = appearanceArg === 'signature' ? [signature, signature, signature, signature] : JSON.parse(readFileSync(appearanceArg, 'utf8'));
const foreground = foregroundArg === 'bunny' ? 'bunny' : Number(foregroundArg);

function voiceSnapshot() {
  const now = Date.now();
  return {
    protocol: 'bunny-voice/1', open: true, sessionId: 'gate-h-fixture', hostEpoch: 'gate-h-fixture', principal: 'workstation',
    mode: 'push_to_talk', state: 'IDLE', capturing: false, playing: false, muted: false, outputHeld: false, level: null, turnId: null,
    generation: 1, partial: null, finalTranscript: null, turnKind: null, answer: null, answerSource: null, route: null, proposal: null,
    clarification: null, uiIntent: null, devices: { input: { name: 'Microphone', muted: false, volume: 0.5, present: true }, output: null, micPrivacy: 'allow' },
    engines: { stt: 'windows-speech', tts: 'windows-sapi', local: true }, error: null, lastInterrupt: null, lastBargeIn: null, duplex: null,
    timing: null, revision: 7, companion: { state: 'READY', reason: 'fixture: session idle', since: now, fixture: true }, createdAt: now, updatedAt: now,
  };
}

function slot(slotId, weapon, displayName, state, text, basis) {
  return {
    slot: slotId, weapon, displayName, description: '', purpose: '', style: 'concise', responsibilities: [], agentId: `fixture-a${slotId}`, active: true,
    agent: { id: `fixture-a${slotId}`, name: `${displayName} (fixture)`, state: 'RUNNING', missionId: `fixture-m${slotId}`, missionTitle: 'Fixture mission', objective: null, projectId: null, failure: null, team: false, updatedAt: Date.now() },
    presentation: { state, label: text, basis },
    attention: { pendingApprovals: state === 'WAITING_FOR_USER' ? 1 : 0 },
    progress: null, result: null, technical: null,
  };
}

function slots() {
  const now = Date.now();
  if (scenario === 'all-working') {
    return [
      slot(1, 'gada', 'Build desk', 'CODING', 'Coding', { kind: 'command', classified: 'agent.coding', stepId: 'fixture-s1' }),
      slot(2, 'spear', 'Research desk', 'RESEARCHING', 'Researching', { kind: 'provider-event', event: 'agent.reading', at: now, taskId: 'fixture-task' }),
      slot(3, 'chakra', 'Release checks', 'TESTING', 'Testing', { kind: 'command', classified: 'agent.testing', stepId: 'fixture-s3' }),
      slot(4, 'sword', 'Inbox triage', 'FILE_WORK', 'Working on files', { kind: 'command', classified: 'agent.file_work', stepId: 'fixture-s4' }),
    ];
  }
  if (scenario === 'all-idle') {
    return ['gada', 'spear', 'chakra', 'sword'].map((weapon, i) => slot(i + 1, weapon, ['Build desk', 'Research desk', 'Release checks', 'Inbox triage'][i], 'IDLE', 'Ready to start', { kind: 'agent-state', agentState: 'CREATED' }));
  }
  return [
    slot(1, 'gada', 'Build desk', 'IDLE', 'Ready to start', { kind: 'agent-state', agentState: 'CREATED' }),
    slot(2, 'spear', 'Research desk', 'RESEARCHING', 'Researching', { kind: 'provider-event', event: 'agent.reading', at: now, taskId: 'fixture-task' }),
    slot(3, 'chakra', 'Release checks', 'TESTING', 'Testing', { kind: 'command', classified: 'agent.testing', stepId: 'fixture-s3' }),
    slot(4, 'sword', 'Inbox triage', 'WAITING_FOR_USER', 'Needs you', { kind: 'agent-state', agentState: 'WAITING_FOR_USER' }),
  ];
}

function state() {
  return {
    health: { operationalState: 'healthy', unavailableSubsystems: [] }, tasks: [], providers: [], projects: [], agents: { agents: [] },
    missions: { missions: [] }, samples: [], thermal: { gpuWarn: 90, cpuWarn: 90 }, presentation: { tasks: [] }, remoteConfigured: false,
    voice: voiceSnapshot(),
    personalAgents: { fixture: true, schema: 'bunny-a.personal-agents.v1', revision: 3, updatedAt: Date.now(), slots: slots(), unslottedAgents: 0, bindable: [] },
    characterAppearance: { fixture: true, schema: 'bunny-a.character-appearance.v1', slots: appearances.map((appearance, i) => ({ slot: i + 1, appearance })) },
    personalAgentContext: { fixture: true, schema: 'bunny-a.personal-agent-context.v1', foreground, slots: [], abilities: [] },
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
      try { ({ action } = JSON.parse(body)); } catch { /* malformed: refused below */ }
      if (logPath) appendFileSync(logPath, JSON.stringify({ at: Date.now(), action }) + '\n');
      if (typeof action === 'string' && action.startsWith('voice.')) { res.end(JSON.stringify({ data: voiceSnapshot() })); return; }
      res.writeHead(409, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'fixture host refuses commands' }));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
});
server.listen(port, '127.0.0.1', () => process.stderr.write(`gate-h fixture host ${scenario} on ${port}\n`));
