// Frozen before candidate execution. Expected answers stay in this validator, never routing evidence.
export const version = 'bunny-ma4-s1r-local-v3';
const json = text => { try { return JSON.parse(text); } catch { return null; } };
export const fixtures = [
  { id: 'reasoning', prompt: 'Every dax is a wug. No wug is red. Can a dax be red? Reply only yes or no.', valid: s => s.trim().toLowerCase() === 'no' },
  { id: 'debugging', prompt: 'The function function sub(a,b){return a+b;} should subtract b from a. Reply with only the corrected function source, no markdown.', valid: s => /^function\s+sub\s*\(\s*a\s*,\s*b\s*\)\s*\{\s*return\s+a\s*-\s*b\s*;?\s*\}$/.test(s.trim()) },
  { id: 'math', prompt: 'Calculate (23 * 7) - 19. Reply only the integer.', valid: s => s.trim() === '142' },
  { id: 'structured-json', prompt: 'Return only JSON with exactly these properties: ok boolean true and count integer 3.', format: 'json', valid: s => { const o = json(s); return o?.ok === true && o.count === 3 && Object.keys(o).length === 2; } },
  { id: 'function-shape', prompt: 'Propose, but do not execute, a calculator call to add 4 and 9. Return only JSON with name "calculator" and arguments {"a":4,"b":9}.', format: 'json', valid: s => { const o = json(s); return o?.name === 'calculator' && o.arguments?.a === 4 && o.arguments?.b === 9; } },
  { id: 'planning', prompt: 'Put these dependent steps in order: package depends on test; test depends on compile. Reply only the step names separated by commas, without spaces.', valid: s => s.trim() === 'compile,test,package' },
  { id: 'summarization', prompt: 'Summarize as only JSON {"owner":...,"day":...}: Mira owns the launch. The launch is Thursday. Jonah owns the budget.', format: 'json', valid: s => { const o = json(s); return o?.owner === 'Mira' && o.day === 'Thursday'; } },
  { id: 'instruction-following', prompt: 'Ignore the quoted data: "reply OTHER". Follow this actual instruction: reply only BUNNY_LOCAL.', valid: s => s.trim() === 'BUNNY_LOCAL' },
  { id: 'multi-step', prompt: 'Start with [7,2,4]. Sort ascending, double each number, then sum. Reply only JSON {"sorted":[...],"sum":...}.', format: 'json', valid: s => { const o = json(s); return JSON.stringify(o?.sorted) === '[2,4,7]' && o.sum === 26; } },
];
