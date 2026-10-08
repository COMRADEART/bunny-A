import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { verifyRelease } from '../../../scripts/bunny-release.mjs';
const dir = resolve('test-results/ma3/t7');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(join(path, item.name)) : [join(path, item.name)]);
const protectedPaths = ['BUNNY_OPENDOTS_ADOPTION_REPORT.md', 'MA1D_FINAL_INDEPENDENT_REVIEW.md', 'MA1_CLAUDE_FINAL_REVIEW.md', 'MA2_FINAL_INDEPENDENT_REVIEW.md', ...walk('memory')];
save('protected-baseline.json', { files: protectedPaths.map(path => ({ path, sha256: hash(readFileSync(path)) })) });
const tests = git('ls-files').split(/\r?\n/).filter(path => /\.test\.(mjs|ts)$/.test(path));
const source = { accepted: 'b3ae2f52aa5b62cd8bbbcca1c9fd37c45c61bd7f', head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), ancestry: git('merge-base', 'b3ae2f52aa5b62cd8bbbcca1c9fd37c45c61bd7f', 'HEAD'), evidenceOnlyDelta: git('diff', '--name-only', 'b3ae2f52aa5b62cd8bbbcca1c9fd37c45c61bd7f', 'HEAD'), status: git('status', '--short'), tests, expected: { scripts: 256, libraries: 611, agents: 24, ui: 59, total: 950 } };
save('source-baseline.json', source);
const productionRoot = join(process.env.LOCALAPPDATA, 'Bunny-A');
const database = join(productionRoot, 'development', 'host.sqlite');
let production = { classification: 'NOT TESTED', observedAt: new Date().toISOString() };
if (existsSync(database)) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const schema = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
    const row = db.prepare("SELECT value FROM settings WHERE key='missions_config'").get();
    production = { ...production, classification: 'LIVE VERIFIED', openedReadOnly: true, schemaSha256: hash(JSON.stringify(schema)), tables: schema.filter(row => row.type === 'table').map(row => row.name), config: row ? JSON.parse(row.value) : null, projects: db.prepare('SELECT id,record FROM projects').all(), installed: verifyRelease(join(productionRoot, 'releases', 'Bunny-A-Windows-v26-MA2-R1')), startupSha256: hash(readFileSync('startup.sh')) };
  } finally { db.close(); }
}
save('production-before.json', production);
save('project-inventory.json', { classification: 'STATIC VERIFIED', hostAuthority: 'HostDatabase.projects (id, record), TaskManager.registerProject', existingFields: ['id', 'name', 'path', 'preferred'], preferredUsedByRouter: false, missions: 'MissionStore.missions.project_id / Mission.projectId', tasks: 'HostDatabase.tasks JSON projectId; Mission step taskId', agents: 'AgentStore.agents.mission_id -> canonical Mission.projectId', artifacts: 'MissionStore.artifacts.mission_id / step_id; ArtifactStore hash + provenance', workspaceConfiguration: 'startHost options.root / BUNNY_HOST_ROOT through scripts/bunny-host.mjs; TaskManager.defaultRoot. Mission dataDirectory owns worktrees. No independent configured agent scratch root.', context: ['bunny-missions/context.ts', 'memory.server.ts', 'skills.server.ts'], ui: 'desktop.tsx Projects; Host-backed add, direct delete currently loses identity', risks: ['Registration canonicalizes but does not pin root identity', 'No durable independent AgentWorkspace', 'Existing project preferred field must not become model ownership', 'No project-scoped artifact UI access check', 'Project histories require bounded queries'], historicalProjects: production.projects ?? [], testInventory: source.tests });
writeFileSync(join(dir, 'baseline.md'), `# T7 baseline\n\nAccepted T6 executable source: ${source.accepted}. Starting HEAD: ${source.head}. Branch: ${source.branch}. Accepted source is an ancestor. HEAD delta is evidence only (${source.evidenceOnlyDelta.split(/\r?\n/).length} files). Protected untracked material is sealed separately. No tracked source edits at baseline.\n\nExpected distinct floor: 950 (256 scripts + 611 library + 24 Agent + 59 UI); actual runners will determine results. Entire retained test inventory is in source-baseline.json.\n\nRead T3 (test-results/ma3/t3), T4, T5 and T6 acceptance reports. Preserve AgentRuntime → MissionManager → TaskManager → BunnyRouter → adapters and T5/T6 authority. Extend the existing projects table; identities and user folders remain in place.\n\nProduction observation is read-only. No deployment, production migration/restart, Startup modification, remote Git action or automatic worktree creation is authorized.\n`);
console.log('Baseline source, protected material, project inventory and read-only production observations saved.');
