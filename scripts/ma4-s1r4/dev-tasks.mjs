// MA4-S1R4 DEVELOPMENT task set. Used to develop and compare workflow strategies; never used to decide a gate.
// Disjoint from the frozen G7 set (scripts/ma4-s1r2/g7-tasks.mjs): different functions, references and hidden tests.
// Same shape and rules as G7 so a strategy measured here transfers: two "all-pass" strict-parser tasks (the G7 v2 rule)
// and eight "reference-validated" tasks across simple / intermediate / debugging / planning.
export const DEV_VERSION = 'bunny-ma4-s1r4-dev-v1';

const T = (id, kind, module, allowedImports, spec, hidden, reference, testerRule = 'reference-validated') => ({ id, kind, module, allowedImports, spec, hiddenTests: `import unittest\nfrom ${module} import *\n${hidden}`, reference, testerRule });

export const DEV_TASKS = [
  T('dv-size', 'strict', 'sizes', ['re'], "Define parse_size(text) converting a size string into a whole number of bytes. The string is a non-negative integer immediately followed by exactly one unit: B (1), KB (1024), MB (1024**2) or GB (1024**3), uppercase, with no spaces: '512B' -> 512, '2KB' -> 2048, '1MB' -> 1048576, '0GB' -> 0. Any other string (empty, no unit, unknown or lowercase unit, spaces, sign, decimal point, two units) must raise ValueError.", `class H(unittest.TestCase):
    def test_valid(self):
        for t, n in [("512B", 512), ("2KB", 2048), ("1MB", 1048576), ("0GB", 0), ("3GB", 3 * 1024 ** 3), ("10KB", 10240)]:
            self.assertEqual(parse_size(t), n, t)
    def test_invalid(self):
        for t in ["", "12", "KB", "2kb", "2 KB", "-1B", "1.5MB", "2KBMB", "2TB", " 2B"]:
            with self.assertRaises(ValueError, msg=t): parse_size(t)
`, `import re
UNITS = {"B": 1, "KB": 1024, "MB": 1024 ** 2, "GB": 1024 ** 3}
def parse_size(text):
    m = re.fullmatch(r"(\\d+)(B|KB|MB|GB)", text) if isinstance(text, str) else None
    if not m:
        raise ValueError(text)
    return int(m.group(1)) * UNITS[m.group(2)]
`, 'all-pass'),
  T('dv-semver', 'strict', 'semver', ['re'], "Define compare_versions(a, b) for version strings of the form MAJOR.MINOR.PATCH, three non-negative integers separated by dots, where a number has no leading zeros unless it is exactly 0. Return -1 if a < b, 0 if equal, 1 if a > b, comparing numerically part by part ('1.10.0' > '1.9.9'). Any malformed version (wrong number of parts, empty part, leading zero, sign, letters, spaces) must raise ValueError.", `class H(unittest.TestCase):
    def test_compare(self):
        for a, b, r in [("1.0.0", "1.0.0", 0), ("1.10.0", "1.9.9", 1), ("0.0.1", "0.1.0", -1), ("2.0.0", "10.0.0", -1), ("3.4.5", "3.4.4", 1)]:
            self.assertEqual(compare_versions(a, b), r, (a, b))
    def test_invalid(self):
        for v in ["1.0", "1.0.0.0", "01.0.0", "1..0", "1.0.a", "-1.0.0", "1.0.0 ", ""]:
            with self.assertRaises(ValueError, msg=v): compare_versions(v, "1.0.0")
            with self.assertRaises(ValueError, msg=v): compare_versions("1.0.0", v)
`, `import re
PART = re.compile(r"0|[1-9][0-9]*")
def _parse(v):
    if not isinstance(v, str):
        raise ValueError(v)
    parts = v.split(".")
    if len(parts) != 3 or not all(PART.fullmatch(p) for p in parts):
        raise ValueError(v)
    return tuple(int(p) for p in parts)
def compare_versions(a, b):
    x, y = _parse(a), _parse(b)
    return (x > y) - (x < y)
`, 'all-pass'),
  T('dv-rle', 'simple', 'rle', [], 'Define rle_encode(s) that run-length encodes a string as each character followed by its run length, e.g. "aaabcc" -> "a3b1c2" and "" -> "". Raise TypeError if s is not a str.', `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(rle_encode("aaabcc"), "a3b1c2"); self.assertEqual(rle_encode(""), ""); self.assertEqual(rle_encode("x"), "x1")
        self.assertEqual(rle_encode("aabbaa"), "a2b2a2"); self.assertEqual(rle_encode("zzzzzzzzzzzz"), "z12")
        with self.assertRaises(TypeError): rle_encode(None)
        with self.assertRaises(TypeError): rle_encode(["a"])
`, `def rle_encode(s):
    if not isinstance(s, str):
        raise TypeError("str required")
    out, i = [], 0
    while i < len(s):
        j = i
        while j < len(s) and s[j] == s[i]:
            j += 1
        out.append(f"{s[i]}{j - i}")
        i = j
    return "".join(out)
`),
  T('dv-dedupe', 'simple', 'dedupe', [], 'Define dedupe(xs) returning a new list with the first occurrence of each element of the list xs, in original order. Elements are hashable. The input list must not be modified.', `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(dedupe([3, 1, 3, 2, 1]), [3, 1, 2]); self.assertEqual(dedupe([]), []); self.assertEqual(dedupe(["a", "a"]), ["a"])
        xs = [1, 1, 2]; self.assertEqual(dedupe(xs), [1, 2]); self.assertEqual(xs, [1, 1, 2])
        self.assertEqual(dedupe([1, True, 2]), [1, 2])
`, `def dedupe(xs):
    seen, out = set(), []
    for x in xs:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out
`),
  T('dv-brackets', 'intermediate', 'brackets', [], 'Define is_balanced(s) returning True when every bracket in s ((), [], {}) is closed by the matching bracket in the correct order, ignoring all other characters, and False otherwise. "" is balanced.', `class H(unittest.TestCase):
    def test(self):
        for s in ["", "()", "a(b[c]{d}e)f", "{[()()]}", "no brackets"]: self.assertTrue(is_balanced(s), s)
        for s in ["(", ")(", "(]", "([)]", "{{}", "}"]: self.assertFalse(is_balanced(s), s)
`, `def is_balanced(s):
    pairs, stack = {")": "(", "]": "[", "}": "{"}, []
    for ch in s:
        if ch in "([{":
            stack.append(ch)
        elif ch in pairs:
            if not stack or stack.pop() != pairs[ch]:
                return False
    return not stack
`),
  T('dv-minstack', 'intermediate', 'minstack', [], 'Define class MinStack with push(x), pop() returning the removed top value, top() returning the top value without removing it, and get_min() returning the smallest value currently in the stack, each in O(1). pop, top and get_min on an empty stack raise IndexError.', `class H(unittest.TestCase):
    def test(self):
        s = MinStack(); s.push(5); s.push(2); s.push(7); s.push(2)
        self.assertEqual(s.get_min(), 2); self.assertEqual(s.pop(), 2); self.assertEqual(s.get_min(), 2); self.assertEqual(s.pop(), 7)
        self.assertEqual(s.pop(), 2); self.assertEqual(s.get_min(), 5); self.assertEqual(s.top(), 5); self.assertEqual(s.pop(), 5)
        for f in (s.pop, s.top, s.get_min):
            with self.assertRaises(IndexError): f()
`, `class MinStack:
    def __init__(self):
        self.items, self.mins = [], []
    def push(self, x):
        self.items.append(x)
        self.mins.append(x if not self.mins or x < self.mins[-1] else self.mins[-1])
    def pop(self):
        if not self.items:
            raise IndexError("empty")
        self.mins.pop()
        return self.items.pop()
    def top(self):
        if not self.items:
            raise IndexError("empty")
        return self.items[-1]
    def get_min(self):
        if not self.mins:
            raise IndexError("empty")
        return self.mins[-1]
`),
  T('dv-bsearch', 'debugging', 'bsearch', [], `binary_search(xs, target) should return the index of target in the sorted list xs, or -1 if it is absent. It misses the last element and can loop forever. Fix it.
def binary_search(xs, target):
    lo, hi = 0, len(xs) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if xs[mid] == target:
            return mid
        if xs[mid] < target:
            lo = mid
        else:
            hi = mid - 1
    return -1`, `class H(unittest.TestCase):
    def test(self):
        xs = [1, 3, 5, 7, 9]
        for i, x in enumerate(xs): self.assertEqual(binary_search(xs, x), i)
        for x in [0, 4, 10]: self.assertEqual(binary_search(xs, x), -1)
        self.assertEqual(binary_search([], 1), -1); self.assertEqual(binary_search([2], 2), 0)
`, `def binary_search(xs, target):
    lo, hi = 0, len(xs) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if xs[mid] == target:
            return mid
        if xs[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
`),
  T('dv-wordcount', 'debugging', 'wordcount', ['re'], `word_count(text) should return a dict mapping each lowercase word to how often it occurs, where a word is a maximal run of letters a-z (case-insensitive); everything else separates words. It is case-sensitive and counts punctuation as part of words. Fix it.
def word_count(text):
    counts = {}
    for w in text.split():
        counts[w] = counts.get(w, 0) + 1
    return counts`, `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(word_count("The cat, the HAT!"), {"the": 2, "cat": 1, "hat": 1}); self.assertEqual(word_count(""), {})
        self.assertEqual(word_count("it's 2 dogs"), {"it": 1, "s": 1, "dogs": 1}); self.assertEqual(word_count("a-a a"), {"a": 3})
`, `import re
def word_count(text):
    counts = {}
    for w in re.findall(r"[a-z]+", text.lower()):
        counts[w] = counts.get(w, 0) + 1
    return counts
`),
  T('dv-bank', 'planning', 'bank', [], 'Plan and implement class Account(owner, balance=0) with deposit(amount) and withdraw(amount) (amount must be > 0, else ValueError; withdrawing more than the balance raises ValueError and changes nothing), transfer(other, amount) moving money to another Account atomically (same rules), balance as a read-only property, and history() returning a list of (kind, amount) tuples in order where kind is "deposit", "withdraw", "transfer_out" or "transfer_in". A negative initial balance raises ValueError.', `class H(unittest.TestCase):
    def test(self):
        a, b = Account("ann", 100), Account("bob")
        a.deposit(50); a.withdraw(30); a.transfer(b, 20)
        self.assertEqual(a.balance, 100); self.assertEqual(b.balance, 20)
        self.assertEqual(a.history(), [("deposit", 50), ("withdraw", 30), ("transfer_out", 20)]); self.assertEqual(b.history(), [("transfer_in", 20)])
        with self.assertRaises(ValueError): a.withdraw(1000)
        with self.assertRaises(ValueError): a.transfer(b, 1000)
        self.assertEqual(a.balance, 100); self.assertEqual(b.balance, 20)
        for bad in (0, -5):
            with self.assertRaises(ValueError): a.deposit(bad)
        with self.assertRaises(ValueError): Account("x", -1)
        with self.assertRaises(AttributeError): a.balance = 5
`, `class Account:
    def __init__(self, owner, balance=0):
        if balance < 0:
            raise ValueError("negative balance")
        self.owner, self._balance, self._history = owner, balance, []
    @property
    def balance(self):
        return self._balance
    def _check(self, amount):
        if amount <= 0:
            raise ValueError("amount must be positive")
    def deposit(self, amount):
        self._check(amount)
        self._balance += amount
        self._history.append(("deposit", amount))
    def withdraw(self, amount):
        self._check(amount)
        if amount > self._balance:
            raise ValueError("insufficient funds")
        self._balance -= amount
        self._history.append(("withdraw", amount))
    def transfer(self, other, amount):
        self._check(amount)
        if amount > self._balance:
            raise ValueError("insufficient funds")
        self._balance -= amount
        other._balance += amount
        self._history.append(("transfer_out", amount))
        other._history.append(("transfer_in", amount))
    def history(self):
        return list(self._history)
`),
  T('dv-pqueue', 'planning', 'pqueue', ['heapq'], 'Plan and implement class TaskQueue with add(name, priority) (priority is an int; a lower number runs first; equal priorities run in insertion order; adding a name that is already queued raises ValueError), pop() returning the name of the next task and removing it (IndexError when empty), and __len__ returning the number of queued tasks.', `class H(unittest.TestCase):
    def test(self):
        q = TaskQueue(); q.add("write", 2); q.add("plan", 1); q.add("test", 2); q.add("ship", 3)
        self.assertEqual(len(q), 4)
        with self.assertRaises(ValueError): q.add("plan", 0)
        self.assertEqual([q.pop() for _ in range(4)], ["plan", "write", "test", "ship"]); self.assertEqual(len(q), 0)
        with self.assertRaises(IndexError): q.pop()
        q.add("plan", 5); self.assertEqual(q.pop(), "plan")
`, `import heapq
class TaskQueue:
    def __init__(self):
        self.heap, self.names, self.n = [], set(), 0
    def add(self, name, priority):
        if name in self.names:
            raise ValueError(name)
        heapq.heappush(self.heap, (priority, self.n, name))
        self.n += 1
        self.names.add(name)
    def pop(self):
        if not self.heap:
            raise IndexError("empty")
        name = heapq.heappop(self.heap)[2]
        self.names.discard(name)
        return name
    def __len__(self):
        return len(self.heap)
`),
];
