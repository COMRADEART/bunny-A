// MA4-S1R2 G7 frozen task set. Written before any S1R2 G7 generation; never edited after outputs are seen.
// Hidden tests and references are host-side only. A pre-flight proves every reference passes its hidden tests.
export const G7_VERSION = 'bunny-ma4-s1r2-g7-v1';

// Unchanged G7 v2 specification and hidden tests (scripts/ma4-s1r/python-workflow.mjs, v2).
const V2_SPEC = "a Python 3 module called duration defining a function parse_duration(text) that converts a duration string into whole seconds. The string is one or more parts of the form <non-negative integer><unit>, units h (hours), m (minutes), s (seconds), appearing in that order, each unit at most once, with no spaces: '1h30m' -> 5400, '45s' -> 45, '2h5s' -> 7205. Any other string (empty, unknown unit, missing number, spaces, wrong order, repeated unit) must raise ValueError. Use only the Python standard library (re is allowed).";
const V2_HIDDEN = `import unittest
from duration import parse_duration
class Hidden(unittest.TestCase):
    def test_valid(self):
        for text, want in [('1h30m', 5400), ('45s', 45), ('2h5s', 7205), ('10m', 600), ('1h1m1s', 3661), ('0s', 0), ('100h', 360000)]:
            self.assertEqual(parse_duration(text), want, text)
    def test_invalid(self):
        for text in ['', 'abc', '5x', '30m1h', '1h1h', 'h', '1 h', '1h 30m', '-5s', '1.5h']:
            with self.assertRaises(ValueError, msg=text):
                parse_duration(text)
`;
const V2_REFERENCE = `import re
def parse_duration(text):
    m = re.fullmatch(r"(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s)?", text)
    if not text or not m:
        raise ValueError(text)
    h, mi, s = (int(g) if g else 0 for g in m.groups())
    return h * 3600 + mi * 60 + s
`;

const T = (id, kind, module, allowedImports, spec, hidden, reference, testerRule = 'reference-validated') => ({ id, kind, module, allowedImports, spec, hiddenTests: `import unittest\nfrom ${module} import *\n${hidden}`, reference, testerRule });

export const G7_TASKS = [
  { id: 'g7-v2-duration', kind: 'regression', module: 'duration', allowedImports: ['re', 'typing'], spec: `Implement ${V2_SPEC}`, hiddenTests: V2_HIDDEN, reference: V2_REFERENCE, testerRule: 'all-pass' },

  T('s1-anagram', 'simple', 'anagram', [], 'Define is_anagram(a, b) returning True when the two strings contain the same letters ignoring case and spaces. Raise TypeError if either argument is not a str.', `class H(unittest.TestCase):
    def test(self):
        self.assertTrue(is_anagram("Listen", "Silent")); self.assertTrue(is_anagram("a gentleman", "Elegant man")); self.assertTrue(is_anagram("", ""))
        self.assertFalse(is_anagram("abc", "abd")); self.assertFalse(is_anagram("aab", "abb"))
        with self.assertRaises(TypeError): is_anagram("a", 1)
        with self.assertRaises(TypeError): is_anagram(None, "a")
`, `def is_anagram(a, b):
    if not isinstance(a, str) or not isinstance(b, str):
        raise TypeError("strings required")
    norm = lambda s: sorted(s.replace(" ", "").lower())
    return norm(a) == norm(b)
`),
  T('s2-chunk', 'simple', 'chunks', [], 'Define chunk(xs, n) that splits the list xs into consecutive lists of length n (the last may be shorter) and returns a list of them. Raise ValueError if n is not a positive integer.', `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(chunk([1,2,3,4,5], 2), [[1,2],[3,4],[5]]); self.assertEqual(chunk([], 3), []); self.assertEqual(chunk([1,2], 5), [[1,2]]); self.assertEqual(chunk([1,2,3], 1), [[1],[2],[3]])
        for n in [0, -1]:
            with self.assertRaises(ValueError): chunk([1], n)
`, `def chunk(xs, n):
    if not isinstance(n, int) or isinstance(n, bool) or n <= 0:
        raise ValueError("n must be positive")
    return [xs[i:i + n] for i in range(0, len(xs), n)]
`),
  T('s3-title', 'simple', 'titles', [], 'Define title_case(s) that capitalizes the first letter of every space-separated word and lowercases the rest, except the small words a, an, the, of, in which stay lowercase unless they are the first word. Words are separated by single spaces.', `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(title_case("the lord of the rings"), "The Lord of the Rings"); self.assertEqual(title_case("A TALE in TIME"), "A Tale in Time")
        self.assertEqual(title_case("an apple"), "An Apple"); self.assertEqual(title_case(""), ""); self.assertEqual(title_case("hELLO"), "Hello")
`, `SMALL = {"a", "an", "the", "of", "in"}
def title_case(s):
    if s == "":
        return ""
    out = []
    for i, w in enumerate(s.split(" ")):
        lw = w.lower()
        out.append(lw if i > 0 and lw in SMALL else lw[:1].upper() + lw[1:])
    return " ".join(out)
`),
  T('i1-roman', 'intermediate', 'roman', ['re'], 'Define roman_to_int(s) converting a canonical uppercase Roman numeral (I, V, X, L, C, D, M with standard subtractive pairs IV, IX, XL, XC, CD, CM) for 1..3999 to an int. Any non-canonical or invalid string (empty, lowercase, IIII, IC, VX, MMMM, other characters) must raise ValueError.', `class H(unittest.TestCase):
    def test_valid(self):
        for s, n in [("III",3),("IV",4),("IX",9),("LVIII",58),("MCMXCIV",1994),("MMMCMXCIX",3999),("XL",40),("CD",400)]: self.assertEqual(roman_to_int(s), n, s)
    def test_invalid(self):
        for s in ["","iv","IIII","IC","VX","MMMM","IIV","XM","A","VV"]:
            with self.assertRaises(ValueError, msg=s): roman_to_int(s)
`, `import re
PAT = re.compile(r"M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})")
VAL = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
def roman_to_int(s):
    if not isinstance(s, str) or not s or not PAT.fullmatch(s):
        raise ValueError(s)
    total = 0
    for i, ch in enumerate(s):
        v = VAL[ch]
        total += -v if i + 1 < len(s) and VAL[s[i + 1]] > v else v
    return total
`),
  T('i2-kv', 'intermediate', 'kvparse', ['re'], 'Define parse_kv(text) that parses "key=value" pairs separated by semicolons into a dict of str to str. Whitespace around keys and values is stripped, empty pairs (from a trailing semicolon) are ignored, values may be empty. Keys must match [a-z_]+ ; an invalid key, a pair without "=", or a duplicate key raises ValueError. parse_kv("") returns {}.', `class H(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(parse_kv("a=1; b = two ;c="), {"a": "1", "b": "two", "c": ""}); self.assertEqual(parse_kv(""), {}); self.assertEqual(parse_kv("x_y=z;"), {"x_y": "z"})
        self.assertEqual(parse_kv("k=a=b"), {"k": "a=b"})
    def test_invalid(self):
        for t in ["a=1;a=2", "A=1", "noequals", "1=2", "=v", "a b=1"]:
            with self.assertRaises(ValueError, msg=t): parse_kv(t)
`, `import re
def parse_kv(text):
    out = {}
    for part in text.split(";"):
        if not part.strip():
            continue
        if "=" not in part:
            raise ValueError(part)
        k, v = part.split("=", 1)
        k, v = k.strip(), v.strip()
        if not re.fullmatch(r"[a-z_]+", k) or k in out:
            raise ValueError(k)
        out[k] = v
    return out
`),
  T('i3-lru', 'intermediate', 'lru', ['collections'], 'Define class LRUCache(capacity) with get(key) returning the stored value or -1, and put(key, value) inserting or updating; when inserting a new key beyond capacity, evict the least recently used key (both get and put count as use). capacity < 1 raises ValueError.', `class H(unittest.TestCase):
    def test(self):
        c = LRUCache(2); c.put(1, 1); c.put(2, 2); self.assertEqual(c.get(1), 1); c.put(3, 3); self.assertEqual(c.get(2), -1)
        c.put(4, 4); self.assertEqual(c.get(1), -1); self.assertEqual(c.get(3), 3); self.assertEqual(c.get(4), 4)
        d = LRUCache(1); d.put("a", 1); d.put("a", 2); self.assertEqual(d.get("a"), 2); d.put("b", 3); self.assertEqual(d.get("a"), -1)
        with self.assertRaises(ValueError): LRUCache(0)
`, `from collections import OrderedDict
class LRUCache:
    def __init__(self, capacity):
        if capacity < 1:
            raise ValueError("capacity")
        self.cap, self.d = capacity, OrderedDict()
    def get(self, key):
        if key not in self.d:
            return -1
        self.d.move_to_end(key)
        return self.d[key]
    def put(self, key, value):
        if key in self.d:
            self.d.move_to_end(key)
        self.d[key] = value
        if len(self.d) > self.cap:
            self.d.popitem(last=False)
`),
  T('d1-flatten', 'debugging', 'flat', [], `This flatten(nested) should flatten arbitrarily nested lists into one flat list, preserving order, but it only flattens one level. Fix it.
def flatten(nested):
    out = []
    for item in nested:
        if isinstance(item, list):
            out.extend(item)
        else:
            out.append(item)
    return out`, `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(flatten([1, [2, [3, [4]], 5]]), [1, 2, 3, 4, 5]); self.assertEqual(flatten([]), []); self.assertEqual(flatten([[[]]]), [])
        self.assertEqual(flatten(["ab", ["c"]]), ["ab", "c"])
`, `def flatten(nested):
    out = []
    for item in nested:
        if isinstance(item, list):
            out.extend(flatten(item))
        else:
            out.append(item)
    return out
`),
  T('d2-moving', 'debugging', 'moving', [], `moving_average(xs, k) should return the list of averages of every window of k consecutive numbers (len(xs) - k + 1 values; [] when k > len(xs)), and raise ValueError when k < 1. It returns one window too few and does not validate k. Fix it.
def moving_average(xs, k):
    return [sum(xs[i:i + k]) / k for i in range(len(xs) - k)]`, `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(moving_average([1, 2, 3, 4], 2), [1.5, 2.5, 3.5]); self.assertEqual(moving_average([5], 1), [5.0]); self.assertEqual(moving_average([1, 2], 3), [])
        self.assertEqual(moving_average([2, 4, 6], 3), [4.0])
        for k in [0, -2]:
            with self.assertRaises(ValueError): moving_average([1, 2], k)
`, `def moving_average(xs, k):
    if k < 1:
        raise ValueError("k")
    return [sum(xs[i:i + k]) / k for i in range(len(xs) - k + 1)]
`),
  T('p1-inventory', 'planning', 'inventory', [], 'Plan and implement a small inventory module with class Inventory having add(name, qty, unit_price) (qty > 0, unit_price >= 0, else ValueError; adding an existing name increases qty and replaces unit_price), remove(name, qty) (KeyError for unknown name, ValueError if qty < 1 or more than stocked; stock reaching 0 deletes the item), quantity(name) (0 if absent) and total_value() (sum of qty * unit_price).', `class H(unittest.TestCase):
    def test(self):
        inv = Inventory(); inv.add("pen", 10, 1.5); inv.add("pen", 5, 2.0); self.assertEqual(inv.quantity("pen"), 15); self.assertEqual(inv.total_value(), 30.0)
        inv.remove("pen", 15); self.assertEqual(inv.quantity("pen"), 0); self.assertEqual(inv.total_value(), 0)
        with self.assertRaises(KeyError): inv.remove("pen", 1)
        inv.add("cup", 2, 3.0)
        with self.assertRaises(ValueError): inv.remove("cup", 3)
        with self.assertRaises(ValueError): inv.remove("cup", 0)
        with self.assertRaises(ValueError): inv.add("x", 0, 1.0)
        with self.assertRaises(ValueError): inv.add("x", 1, -1.0)
`, `class Inventory:
    def __init__(self):
        self.items = {}
    def add(self, name, qty, unit_price):
        if qty <= 0 or unit_price < 0:
            raise ValueError("bad add")
        q = self.items.get(name, (0, 0))[0]
        self.items[name] = (q + qty, unit_price)
    def remove(self, name, qty):
        if name not in self.items:
            raise KeyError(name)
        q, p = self.items[name]
        if qty < 1 or qty > q:
            raise ValueError("bad remove")
        if q - qty == 0:
            del self.items[name]
        else:
            self.items[name] = (q - qty, p)
    def quantity(self, name):
        return self.items.get(name, (0, 0))[0]
    def total_value(self):
        return sum(q * p for q, p in self.items.values())
`),
  T('p2-bucket', 'planning', 'bucket', [], 'Plan and implement a token-bucket rate limiter: class TokenBucket(capacity, refill_per_second, clock) where clock is a zero-argument function returning the current time in seconds. The bucket starts full. allow() refills tokens by elapsed time * refill_per_second (never above capacity), then consumes one token and returns True if at least one token is available, otherwise returns False. capacity < 1 or refill_per_second < 0 raises ValueError. Do not call any real clock.', `class H(unittest.TestCase):
    def test(self):
        t = [0.0]; b = TokenBucket(2, 1.0, lambda: t[0])
        self.assertTrue(b.allow()); self.assertTrue(b.allow()); self.assertFalse(b.allow())
        t[0] = 0.5; self.assertFalse(b.allow()); t[0] = 1.0; self.assertTrue(b.allow()); self.assertFalse(b.allow())
        t[0] = 100.0; self.assertTrue(b.allow()); self.assertTrue(b.allow()); self.assertFalse(b.allow())
        with self.assertRaises(ValueError): TokenBucket(0, 1.0, lambda: 0)
        with self.assertRaises(ValueError): TokenBucket(1, -1.0, lambda: 0)
`, `class TokenBucket:
    def __init__(self, capacity, refill_per_second, clock):
        if capacity < 1 or refill_per_second < 0:
            raise ValueError("bad bucket")
        self.capacity, self.rate, self.clock = capacity, refill_per_second, clock
        self.tokens, self.last = float(capacity), clock()
    def allow(self):
        now = self.clock()
        self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.rate)
        self.last = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False
`),
];
