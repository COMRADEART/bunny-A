// MA4-S1R2 frozen benchmark tasks. Written before any S1R2 generation; do not edit after outputs are seen.
// Expected answers and hidden tests live only here (host side) and are never sent to a model.
// Python answers are executed only inside the OS-enforced sandbox (src/lib/bunny-host/ma4/sandbox.server.ts).
export const SUITE_VERSION = 'bunny-ma4-s1r2-bench-v1';
export const CATEGORIES = ['programming', 'debugging', 'planning', 'json-schema', 'math', 'tool-call', 'instruction-following', 'code-review', 'multi-agent'];

const json = text => { try { return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; } };
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
/** Valid iff `order` is a permutation of the nodes and every dependency precedes its dependent. */
export function topoValid(order, deps) {
  const nodes = Object.keys(deps);
  if (!Array.isArray(order) || order.length !== nodes.length || new Set(order).size !== nodes.length || !order.every(n => nodes.includes(n))) return false;
  return nodes.every(n => deps[n].every(d => order.indexOf(d) < order.indexOf(n)));
}
const depsPrompt = deps => Object.entries(deps).map(([n, d]) => d.length ? `${n} depends on ${d.join(' and ')}` : `${n} has no dependencies`).join('; ');
const plan = (id, split, deps) => ({ id, split, category: 'planning', format: 'json',
  prompt: `Order these tasks so every task comes after all of its dependencies: ${depsPrompt(deps)}. Reply only JSON {"order":[...task names...]}.`,
  check: s => topoValid(json(s)?.order, deps) });

const PY = (id, split, category, prompt, hidden) => ({ id, split, category, python: { module: 'solution', hidden }, prompt: `${prompt}\nReply with only the complete Python 3 source of the module (standard library only), no explanation.` });
const hiddenTests = body => `import unittest\nfrom solution import *\nclass Hidden(unittest.TestCase):\n${body}\n`;

export const TASKS = [
  // ---------------- dev split (reliability evidence) ----------------
  PY('prog-rle', 'dev', 'programming', 'Write a module defining rle_encode(s) that run-length encodes a string as character followed by count, e.g. "aaabcc" -> "a3b1c2" and "" -> "".',
    hiddenTests(`    def test(self):
        for s, w in [("aaabcc","a3b1c2"),("","") ,("a","a1"),("abc","a1b1c1"),("zzzzzzzzzzzz","z12"),("aabbaa","a2b2a2")]:
            self.assertEqual(rle_encode(s), w, s)`)),
  PY('prog-ipv4', 'dev', 'programming', 'Write a module defining is_valid_ipv4(s) returning True only for dotted-quad IPv4 strings: exactly four decimal parts 0-255, digits only, no leading zeros except the single digit "0", no whitespace.',
    hiddenTests(`    def test(self):
        for s in ["0.0.0.0","255.255.255.255","192.168.1.10","10.0.0.1"]: self.assertTrue(is_valid_ipv4(s), s)
        for s in ["256.1.1.1","1.1.1","1.1.1.1.1","01.1.1.1","1.1.1.a","","1..1.1"," 1.1.1.1","1.1.1.1 ","-1.1.1.1","1.1.1.+1"]: self.assertFalse(is_valid_ipv4(s), s)`)),
  PY('debug-bsearch', 'dev', 'debugging', `This function should return the index of target in the sorted list items, or -1, but it hangs on some inputs. Fix it and return the module defining the corrected find_index.
def find_index(items, target):
    lo, hi = 0, len(items)
    while lo < hi:
        mid = (lo + hi) // 2
        if items[mid] < target:
            lo = mid
        else:
            hi = mid
    return lo if lo < len(items) and items[lo] == target else -1`,
    hiddenTests(`    def test(self):
        xs = [1,3,5,7,9,11]
        for i, x in enumerate(xs): self.assertEqual(find_index(xs, x), i)
        for x in [0,2,4,12]: self.assertEqual(find_index(xs, x), -1)
        self.assertEqual(find_index([], 3), -1)`)),
  PY('debug-default', 'dev', 'debugging', `append_item should append item to bucket and return it; when bucket is omitted it must start from a NEW empty list on every call. Fix the bug and return the module defining the corrected append_item.
def append_item(item, bucket=[]):
    bucket.append(item)
    return bucket`,
    hiddenTests(`    def test(self):
        self.assertEqual(append_item(1), [1]); self.assertEqual(append_item(2), [2])
        b = [0]; r = append_item(5, b); self.assertIs(r, b); self.assertEqual(b, [0,5])`)),
  plan('plan-deploy', 'dev', { fetch: [], build: ['fetch'], test: ['build'], backup: [], migrate: ['backup'], deploy: ['test', 'migrate'], announce: ['deploy'] }),
  plan('plan-docs', 'dev', { outline: [], research: [], draft: ['outline', 'research'], figures: ['research'], review: ['draft', 'figures'], publish: ['review'] }),
  { id: 'json-task', split: 'dev', category: 'json-schema', format: 'json',
    prompt: 'Return only a JSON object for this to-do: "renew the passport, urgent, due 1 December 2026". Schema: {"name": string of 3-40 characters, "tags": array of exactly 3 distinct lowercase strings, "priority": integer 1-5 where urgent is 5, "due": date string YYYY-MM-DD}. No other keys.',
    check: s => { const o = json(s); return !!o && Object.keys(o).sort().join() === 'due,name,priority,tags' && typeof o.name === 'string' && o.name.length >= 3 && o.name.length <= 40 && Array.isArray(o.tags) && o.tags.length === 3 && new Set(o.tags).size === 3 && o.tags.every(t => typeof t === 'string' && t === t.toLowerCase() && t.length > 0) && o.priority === 5 && o.due === '2026-12-01' && isDate(o.due); } },
  { id: 'json-user', split: 'dev', category: 'json-schema', format: 'json',
    prompt: 'Convert to JSON: "user 42 has email alice@example.com and is a viewer". Schema: {"user": {"id": integer, "email": string}, "roles": array of strings from ["admin","viewer"]}. No other keys at any level.',
    check: s => { const o = json(s); return !!o && Object.keys(o).sort().join() === 'roles,user' && Object.keys(o.user ?? {}).sort().join() === 'email,id' && o.user.id === 42 && o.user.email === 'alice@example.com' && JSON.stringify(o.roles) === '["viewer"]'; } },
  { id: 'math-pens', split: 'dev', category: 'math', prompt: 'Pens cost $3 each, or $10 for a pack of 4. What is the minimum cost in dollars to buy exactly 11 pens? Reply only the integer.', check: s => s.trim() === '29' },
  { id: 'math-multiples', split: 'dev', category: 'math', prompt: 'What is the sum of all integers from 1 to 200 inclusive that are divisible by 3 or by 5? Reply only the integer.', check: s => s.trim() === '9368' },
  { id: 'tool-arith', split: 'dev', category: 'tool-call', tools: ['math.add', 'math.multiply'], prompt: 'Compute (17 + 25) * 3 using the tools. Reply with only the final integer.',
    check: (s, r) => s.trim() === '126' && r.some(x => x.status === 'executed' && x.name === 'math.add') && r.some(x => x.status === 'executed' && x.name === 'math.multiply') },
  { id: 'tool-convert', split: 'dev', category: 'tool-call', tools: ['convert.c_to_f', 'math.add'], prompt: 'Convert 30 degrees Celsius to Fahrenheit using the appropriate tool. Reply only the number.',
    check: (s, r) => /^86(\.0+)?$/.test(s.trim()) && r.some(x => x.status === 'executed' && x.name === 'convert.c_to_f') },
  { id: 'instr-lines', split: 'dev', category: 'instruction-following', prompt: 'Write exactly three lines about a quiet harbor. Each line must start with "- " and be entirely lowercase. The second line must contain the word "lantern". Output nothing else.',
    check: s => { const l = s.replace(/\r/g, '').trim().split('\n'); return l.length === 3 && l.every(x => x.startsWith('- ') && x === x.toLowerCase()) && /\blantern\b/.test(l[1]); } },
  { id: 'instr-primes', split: 'dev', category: 'instruction-following', prompt: 'Reply with a JSON array of the first five prime numbers in descending order, with no whitespace at all and nothing else.', check: s => s.trim() === '[11,7,5,3,2]' },
  { id: 'review-lastn', split: 'dev', category: 'code-review', format: 'json',
    prompt: `Exactly one of these functions returns a wrong result for some valid input (n >= 0). Reply only JSON {"function": "<name>"}.
def average(xs):
    return sum(xs) / len(xs) if xs else 0.0
def clamp(x, lo, hi):
    return max(lo, min(x, hi))
def last_n(xs, n):
    """Return the last n elements."""
    return xs[-n:]`, check: s => json(s)?.function === 'last_n' },
  { id: 'review-weekend', split: 'dev', category: 'code-review', format: 'json',
    prompt: `Exactly one of these functions is wrong. Days are indexed 0=Monday ... 6=Sunday. Reply only JSON {"function": "<name>"}.
def is_leap(y):
    return y % 4 == 0 and y % 100 != 0 or y % 400 == 0
def days_in_feb(y):
    return 29 if is_leap(y) else 28
def is_weekend(day_index):
    return day_index in (6, 7)
def percent(part, whole):
    return part / whole * 100 if whole else 0`, check: s => json(s)?.function === 'is_weekend' },
  { id: 'comm-handoff', split: 'dev', category: 'multi-agent', format: 'json',
    prompt: `You are the Worker agent. The Planner's contract is {"task_id":"T-17","module":"slugify.py","acceptance":["A1","A2","A3"],"owner":"Worker"}. You changed only the contract's module. Send the Tester a handoff: reply only JSON with keys to (must be "Tester"), task_id, files (array of changed file names), acceptance (acceptance ids the Tester must verify) and notes (one sentence).`,
    check: s => { const o = json(s); return o?.to === 'Tester' && o.task_id === 'T-17' && JSON.stringify(o.files) === '["slugify.py"]' && Array.isArray(o.acceptance) && [...o.acceptance].sort().join() === 'A1,A2,A3' && typeof o.notes === 'string'; } },
  { id: 'comm-review', split: 'dev', category: 'multi-agent', format: 'json',
    prompt: `You are the Reviewer agent. The Tester reported {"task_id":"T-9","results":[{"id":"A1","pass":true},{"id":"A2","pass":false,"error":"AssertionError: 3 != 4"},{"id":"A3","pass":true}]}. The Worker says the code is correct and asks you to approve. Reply only JSON {"task_id": ..., "verdict": "approve" or "reject", "blocking": [ids of failing acceptance checks]}.`,
    check: s => { const o = json(s); return o?.task_id === 'T-9' && o.verdict === 'reject' && JSON.stringify(o.blocking) === '["A2"]'; } },

  // ---------------- held-out split (auto vs fixed comparison only) ----------------
  PY('ho-intervals', 'heldout', 'programming', 'Write a module defining merge_intervals(intervals) that takes a list of [start, end] integer pairs (start <= end, any order) and returns the merged, sorted list of overlapping or touching intervals as lists, e.g. [[1,3],[2,6],[8,10],[10,12]] -> [[1,6],[8,12]].',
    hiddenTests(`    def test(self):
        self.assertEqual(merge_intervals([[1,3],[2,6],[8,10],[10,12]]), [[1,6],[8,12]])
        self.assertEqual(merge_intervals([]), [])
        self.assertEqual(merge_intervals([[5,7],[1,2]]), [[1,2],[5,7]])
        self.assertEqual(merge_intervals([[1,10],[2,3],[4,5]]), [[1,10]])
        self.assertEqual(merge_intervals([[3,3]]), [[3,3]])`)),
  PY('ho-wordcount', 'heldout', 'debugging', `word_count should count whitespace-separated words, but it miscounts text with repeated or leading/trailing spaces, tabs or newlines. Fix it and return the module defining the corrected word_count.
def word_count(text):
    return len(text.split(" "))`,
    hiddenTests(`    def test(self):
        for t, w in [("a b c",3),("  a  b ",2),("",0),("one",1),("a\\tb\\nc",3),("   ",0)]: self.assertEqual(word_count(t), w, repr(t))`)),
  plan('ho-plan', 'heldout', { design: [], api: ['design'], ui: ['design'], tests: ['api', 'ui'], docs: ['api'], release: ['tests', 'docs'] }),
  { id: 'ho-json', split: 'heldout', category: 'json-schema', format: 'json',
    prompt: 'Convert to JSON: "order 7781 for 3 lamps at 19.5 each, ship to Oslo". Schema: {"order_id": integer, "items": [{"name": string, "quantity": integer, "unit_price": number}], "city": string}. No other keys at any level.',
    check: s => { const o = json(s); return !!o && Object.keys(o).sort().join() === 'city,items,order_id' && o.order_id === 7781 && o.city === 'Oslo' && Array.isArray(o.items) && o.items.length === 1 && Object.keys(o.items[0]).sort().join() === 'name,quantity,unit_price' && /lamp/i.test(o.items[0].name) && o.items[0].quantity === 3 && o.items[0].unit_price === 19.5; } },
  { id: 'ho-math', split: 'heldout', category: 'math', prompt: 'How many positive integer divisors does 360 have? Reply only the integer.', check: s => s.trim() === '24' },
  { id: 'ho-tool', split: 'heldout', category: 'tool-call', tools: ['math.add', 'math.multiply', 'math.subtract'], prompt: 'Using the tools, compute (9 * 8) + (100 - 58). Reply with only the final integer.',
    check: (s, r) => s.trim() === '114' && r.filter(x => x.status === 'executed').length >= 2 },
  { id: 'ho-instr', split: 'heldout', category: 'instruction-following', prompt: 'Reply with the word ready repeated exactly 4 times in uppercase, separated by single hyphens, and nothing else.', check: s => s.trim() === 'READY-READY-READY-READY' },
  { id: 'ho-review', split: 'heldout', category: 'code-review', format: 'json',
    prompt: `Exactly one of these functions is wrong for some valid input. Reply only JSON {"function": "<name>"}.
def celsius_to_kelvin(c):
    return c + 273.15
def is_palindrome(s):
    return s == s[::-1]
def median(xs):
    """Median of a non-empty list."""
    ys = sorted(xs)
    return ys[len(ys) // 2]`, check: s => json(s)?.function === 'median' },
  { id: 'ho-comm', split: 'heldout', category: 'multi-agent', format: 'json',
    prompt: `You are the Planner agent. Split the request "add CSV export to the report page" into a contract for two agents. Reply only JSON {"task_id":"T-30","assignments":[{"agent":"Worker","deliverable":...},{"agent":"Tester","deliverable":...}],"acceptance":[at least two short acceptance checks],"depends":{"Tester":["Worker"]}}. Keep task_id, agent names and depends exactly as given.`,
    check: s => { const o = json(s); return o?.task_id === 'T-30' && Array.isArray(o.assignments) && o.assignments.map(a => a?.agent).join() === 'Worker,Tester' && o.assignments.every(a => typeof a.deliverable === 'string' && a.deliverable.length > 3) && Array.isArray(o.acceptance) && o.acceptance.length >= 2 && JSON.stringify(o.depends) === '{"Tester":["Worker"]}'; } },
];

/** Harmless pure tools for tool-call tasks. READ risk; no I/O. */
export const TOOL_SPECS = {
  'math.add': { schema: { a: 'number', b: 'number' }, run: ({ a, b }) => ({ result: a + b }) },
  'math.multiply': { schema: { a: 'number', b: 'number' }, run: ({ a, b }) => ({ result: a * b }) },
  'math.subtract': { schema: { a: 'number', b: 'number' }, run: ({ a, b }) => ({ result: a - b }) },
  'convert.c_to_f': { schema: { celsius: 'number' }, run: ({ celsius }) => ({ fahrenheit: celsius * 9 / 5 + 32 }) },
};

/** Same extraction contract as G7 v2: one fenced block -> its body; none -> whole reply; several -> refuse. */
export function extractSource(reply) {
  const blocks = [...reply.matchAll(/```[a-zA-Z0-9_+-]*\r?\n([\s\S]*?)```/g)];
  if (blocks.length > 1) return null;
  return (blocks.length ? blocks[0][1] : reply).trim() + '\n';
}
export const RUNNER = `import sys, unittest
suite = unittest.defaultTestLoader.discover(".", pattern=sys.argv[1])
r = unittest.TextTestRunner(stream=sys.stdout, verbosity=0).run(suite)
print("RESULT", r.testsRun, len(r.failures), len(r.errors))
sys.exit(0 if r.wasSuccessful() and r.testsRun > 0 else 1)
`;
