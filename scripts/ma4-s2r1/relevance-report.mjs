// MA4-S2R1 deterministic retrieval report (no model): every S2 skill against every task of a split, with each
// decision's reasons and score, and retrieval quality against the frozen ground truth.
//   node --experimental-strip-types scripts/ma4-s2r1/relevance-report.mjs --split dev|s2|heldout [--out file.json]
// `heldout` is run once, after the candidate is frozen (pre-registration §4); dev and s2 are development data.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { selectRelevant, taskSignature } from '../../src/lib/bunny-host/ma4/relevance.ts';
import { S2R1_TASKS, RELEVANCE } from './eval-tasks.mjs';
import { S2_TASKS } from '../ma4-s2/eval-tasks.mjs';
import { openCorpus, SCOPE } from './corpus.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const SPLIT = arg('--split', 'dev'), OUT = arg('--out', null);
// S2 development regressions: the source tasks of the qualified skills are applicable; every other S2 task is not.
const S2_TRUTH = { 'tr-isodate': 'date-iso', 'tr-slug': 'slug', 'tr-median': 'median' };
const FAMILY = { 'parse-date-procedure': 'date-iso', slugify: 'slug', 'calculate-median': 'median', 'compute-median': 'median' };
const tasks = SPLIT === 's2' ? S2_TASKS : S2R1_TASKS.filter(t => t.split === SPLIT);
const truth = t => SPLIT === 's2' ? (S2_TRUTH[t.id] ? { relation: 'applicable', family: S2_TRUTH[t.id] } : { relation: 'none' }) : RELEVANCE[t.id];

const { registry } = openCorpus();
const skills = registry.list();
const now = Date.now(), rows = [];
for (const t of tasks) {
  const sig = taskSignature(t, { projectScope: SCOPE });
  const pick = selectRelevant(skills, sig, { mode: 'evaluation', now });
  const want = truth(t), got = pick.selected ? FAMILY[pick.selected.name] ?? pick.selected.name : null;
  const outcome = want.relation === 'applicable' ? (got === want.family ? 'TP' : got ? 'FP' : 'FN') : (got ? 'FP' : 'TN');
  rows.push({ task: t.id, relation: want.relation, family: want.family ?? null, selected: pick.selected ? `${pick.selected.name}@v${pick.selected.version}` : null, outcome, excerptChars: pick.text.length,
    signature: { category: sig.category, operations: sig.operations, inputTypes: sig.inputTypes, formats: sig.formats, outputTypes: sig.outputTypes },
    decisions: pick.decisions.map(d => ({ skill: `${d.name}@v${d.version}`, eligible: d.eligible, score: d.score, parts: d.parts ?? null, reasons: d.reasons })) });
  const best = pick.decisions.filter(d => d.score !== null).map(d => `${d.name}=${d.score}`).join(' ');
  console.log(`${t.id.padEnd(15)} ${want.relation.padEnd(10)} ${outcome}  ${(rows.at(-1).selected ?? '-').padEnd(26)} ${best}`);
}
const count = o => rows.filter(r => r.outcome === o).length;
const summary = { split: SPLIT, tasks: rows.length, skills: skills.length, TP: count('TP'), FN: count('FN'), FP: count('FP'), TN: count('TN'), noSkill: rows.filter(r => !r.selected).length };
console.log(JSON.stringify(summary));
if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify({ summary, at: new Date(now).toISOString(), rows }, null, 2) + '\n'); }
