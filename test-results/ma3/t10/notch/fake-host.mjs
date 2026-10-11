// M-A-3 T10 notch evidence: a DISPOSABLE test double for the Island, never production.
// Serves only the two routes the Island reads (GET /state and POST /command) on 127.0.0.1 with a fake token.
// Usage: node fake-host.mjs <port 43800-43899> <voiceMode idle|listening|speaking|approval|muted> [commandLogPath] [agentCount]
// Every command the Island sends is appended to the log as one JSON line, so a run can prove what was requested.
import http from 'node:http';
import { appendFileSync } from 'node:fs';

const port = Number(process.argv[2]);
const mode = process.argv[3] || 'idle';
const logPath = process.argv[4] || '';
const agentCount = Number(process.argv[5] || 3); // 3 = the evidence fixture; more exercises the "+N" overflow chip
if (!(port >= 43800 && port <= 43899)) { console.error('port must be 43800-43899'); process.exit(2); }
const token = 'notch-fake-token';

function voiceSnapshot() {
  const now = Date.now();
  const base = {
    protocol: 'bunny-voice/1', open: true, sessionId: 'notch', hostEpoch: 'notch', principal: 'workstation',
    mode: 'push_to_talk', state: 'IDLE', capturing: false, playing: false, muted: false,
    level: null, turnId: null, generation: 1, partial: null, finalTranscript: null, turnKind: null,
    answer: null, answerSource: null, route: null, proposal: null, clarification: null, uiIntent: null,
    devices: { input: { name: 'Microphone', muted: false, volume: 0.5, present: true }, output: null, micPrivacy: 'allow' },
    engines: { stt: 'windows-speech', tts: 'windows-sapi', local: true }, error: null, lastInterrupt: null,
    timing: null, createdAt: now, updatedAt: now,
  };
  if (mode === 'listening') {
    Object.assign(base, { state: 'LISTENING', capturing: true, partial: 'what is the build doing',
      finalTranscript: null, level: { rms: 0.28, peak: 0.5, speech: true, at: now } });
  } else if (mode === 'speaking') {
    Object.assign(base, { state: 'SPEAKING', playing: true, finalTranscript: 'status please',
      answer: 'Builder is running tests. Reviewer is waiting for your approval.', answerSource: 'model',
      route: { taskId: 'chat', provider: 'ollama', model: 'UNKNOWN' } });
  } else if (mode === 'approval') {
    Object.assign(base, { proposal: { id: 'p1', action: 'agent.pause', agentId: 'a1', agentName: 'Builder', revision: 1,
      confirmVia: 'voice_or_screen', createdAt: now, expiresAt: now + 30000, hostEpoch: 'notch' } });
  } else if (mode === 'muted') {
    Object.assign(base, { state: 'MUTED', muted: true, devices: { input: { name: 'Microphone', muted: true, volume: 0, present: true }, output: null, micPrivacy: 'allow' } });
  }
  return base;
}

// Two working agents and one agent waiting for the user's approval (the evidence fixture).
function agents() {
  const now = Date.now();
  return [
    { id: 'a1', name: 'Builder', state: 'RUNNING', authorization: { state: 'ACTIVE', pending: [] }, activity: { verification: 'Unverified' }, updatedAt: now - 1000 },
    { id: 'a2', name: 'Reviewer', state: 'RUNNING', authorization: { state: 'ACTIVE', pending: [] }, activity: { verification: 'Unverified' }, updatedAt: now - 2000 },
    { id: 'a3', name: 'Deployer', state: 'WAITING_FOR_USER', authorization: { state: 'WAITING_FOR_USER', pending: [{ id: 'auth1' }] }, activity: { verification: 'Unverified' }, updatedAt: now - 3000 },
  ].concat(Array.from({ length: Math.max(0, agentCount - 3) }, (_, i) => ({ id: 'x' + i, name: 'Extra' + i, state: 'RUNNING', authorization: { state: 'ACTIVE', pending: [] }, activity: { verification: 'Unverified' }, updatedAt: now - 4000 - i })));
}

function state() {
  return {
    health: { operationalState: 'healthy', unavailableSubsystems: [] }, tasks: [], providers: [], projects: [],
    agents: { agents: agents() }, missions: { missions: [] }, samples: [], thermal: { gpuWarn: 90, cpuWarn: 90 },
    presentation: { tasks: [] }, remoteConfigured: false, voice: voiceSnapshot(),
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
      res.writeHead(400); res.end('{"error":"fake host answers voice actions only"}');
      return;
    }
    res.writeHead(404); res.end('{}');
  });
});
server.listen(port, '127.0.0.1', () => process.stderr.write('notch fake host ' + mode + ' on ' + port + '\n'));
