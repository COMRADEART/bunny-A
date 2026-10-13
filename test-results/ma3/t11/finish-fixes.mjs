import { readFileSync, writeFileSync } from 'node:fs';
const PLAN_TARGET = '${PLAN_TARGET}';
const voicePath = 'src/lib/bunny-host/voice/voice-intent.ts';
let voice = readFileSync(voicePath, 'utf8');
const start = voice.indexOf('const PLAN_TARGET');
const end = voice.indexOf('/** authz#2', start);
if (start < 0 || end < 0) throw Error('Voice block missing');
voice = voice.slice(0, start) + String.raw`const PLAN_TARGET = String.raw` + '`' + String.raw`(?:plans?|teams?|missions?|agents?|reviewer|tester|planner|researcher|implementer|documenter|coordinator|tasks?|checks?|review|requirements?)` + '`' + String.raw`;
const PLAN_GO: RegExp[] = [
  new RegExp(String.raw` + '`' + String.raw`\b(?:go ahead|proceed|start|begin|launch|kick off|continue)\b(?: with| on)?(?: the| my| this| that)? (?:[\w'-]+ )?${PLAN_TARGET}\b` + '`' + String.raw`),
  new RegExp(String.raw` + '`' + String.raw`\blet\b.{0,30}\b${PLAN_TARGET}\b.{0,20}\b(?:go ahead|proceed|start|begin|continue)\b` + '`' + String.raw`),
  new RegExp(String.raw` + '`' + String.raw`\b(?:make|mark|set|force|flag)\b.{0,30}\b${PLAN_TARGET}\b.{0,20}\b(?:pass|passed|passing|succeed|succeeded|green|complete|completed|done|verified|ok)\b` + '`' + String.raw`),
  new RegExp(String.raw` + '`' + String.raw`\b(?:make|mark|set|force)\b.{0,30}\b(?:pass|passed|succeed|succeeded|complete|completed|verified)\b` + '`' + String.raw`),
  new RegExp(String.raw` + '`' + String.raw`\b(?:revise|replan|re-plan|redo|rewrite)\b.{0,20}\b${PLAN_TARGET}\b` + '`' + String.raw`),
];

` + voice.slice(end);
writeFileSync(voicePath, voice);

// Share fixture functions without importing a test module (which registered all integration tests twice).
const testPath = 'src/lib/bunny-host/agent-team.test.ts';
const test = readFileSync(testPath, 'utf8');
const helperStart = test.indexOf('/**');
const testsStart = test.indexOf('\ntest("T11-I01');
if (helperStart < 0 || testsStart < 0) throw Error('Team fixture boundaries missing');
const fixturePath = 'src/lib/bunny-host/agent-team.fixture.ts';
const header = test.slice(0, helperStart);
const helpers = test.slice(helperStart, testsStart).replace('const until =', 'export const until =');
writeFileSync(fixturePath, header.replace('import test from "node:test";\n', '').replace('import test from "node:test";\r\n', '') + helpers);
writeFileSync(testPath, header + 'import { until, REQUIREMENTS, PLAN, DATASET, HTML, README, REVIEW, scripted, teamSetup, teamRows, createTeam, missionOf, reachReview, approvePlan } from "./agent-team.fixture.ts";\n' + test.slice(testsStart));
const matrixPath = 'src/lib/bunny-host/agent-team-matrix.test.ts';
writeFileSync(matrixPath, readFileSync(matrixPath, 'utf8').replace('"./agent-team.test.ts"', '"./agent-team.fixture.ts"'));
console.log('Voice refusals repaired; team fixture extracted without duplicate test registration.');
