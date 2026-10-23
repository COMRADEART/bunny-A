// MA4-S2 evaluation suites. Written and committed BEFORE any S2-specific implementation was run against them; never
// edited after outputs are seen (the task hash is pinned in docs/ma4-s2/INTELLIGENCE_EVALUATION.md).
// Disjoint from the frozen G7 set, the S1R4 dev set and the S1R2 benchmark/held-out sets: different functions,
// specifications, references and hidden tests. Same shape and rules as G7 so the workflow runs them unchanged.
//   TRAIN    — the only tasks skills may be discovered from.
//   QUALIFY  — the only tasks a candidate skill is benchmark-qualified on (never a discovery source).
//   HELDOUT  — the decisive A/B/C comparison; never a discovery or qualification source.
// Hidden tests and references are host-side only: no prompt, skill or memory may contain them (checked by leakage()).
export const S2_EVAL_VERSION = 'bunny-ma4-s2-eval-v1';

const T = (id, split, kind, module, allowedImports, spec, hidden, reference, testerRule = 'reference-validated') =>
  ({ id, split, kind, module, allowedImports, spec, hiddenTests: `import unittest\nfrom ${module} import *\n${hidden}`, reference, testerRule });

export const S2_TASKS = [
  // ── TRAIN ────────────────────────────────────────────────────────────────────────────────────────────────────────
  T('tr-isodate', 'train', 'strict', 'isodate', ['re', 'calendar'], "Define parse_date(text) returning (year, month, day) as ints for a calendar date written exactly as YYYY-MM-DD: four digits, a hyphen, two digits, a hyphen, two digits. The date must exist (leap years follow the Gregorian rules, so 2024-02-29 exists and 2023-02-29 does not). '2024-02-29' -> (2024, 2, 29), '1999-12-31' -> (1999, 12, 31). Any other string (empty, other separators, one-digit fields, month or day out of range, a non-existent date, spaces, extra characters) must raise ValueError.", `class H(unittest.TestCase):
    def test_valid(self):
        for t, r in [("2024-02-29", (2024, 2, 29)), ("1999-12-31", (1999, 12, 31)), ("2000-01-01", (2000, 1, 1)), ("2023-04-30", (2023, 4, 30))]:
            self.assertEqual(parse_date(t), r, t)
    def test_invalid(self):
        for t in ["", "2023-02-29", "2023-13-01", "2023-00-10", "2023-04-31", "2023/04/01", "2023-4-01", "23-04-01", " 2023-04-01", "2023-04-01x", "1900-02-29"]:
            with self.assertRaises(ValueError, msg=t): parse_date(t)
`, `import re, calendar
def parse_date(text):
    m = re.fullmatch(r"(\\d{4})-(\\d{2})-(\\d{2})", text) if isinstance(text, str) else None
    if not m:
        raise ValueError(text)
    y, mo, d = (int(g) for g in m.groups())
    if not 1 <= mo <= 12 or not 1 <= d <= calendar.monthrange(y, mo)[1]:
        raise ValueError(text)
    return (y, mo, d)
`, 'all-pass'),
  T('tr-hexcolor', 'train', 'strict', 'hexcolor', ['re'], "Define parse_color(text) returning an (r, g, b) tuple of ints for a CSS hex colour: '#' followed by exactly 6 hex digits (RRGGBB) or exactly 3 hex digits (RGB, each digit doubled), letters in either case. '#ff8000' -> (255, 128, 0), '#ABC' -> (170, 187, 204), '#000' -> (0, 0, 0). Any other string (empty, no '#', 1, 2, 4, 5 or 7+ digits, non-hex characters, spaces) must raise ValueError.", `class H(unittest.TestCase):
    def test_valid(self):
        for t, r in [("#ff8000", (255, 128, 0)), ("#ABC", (170, 187, 204)), ("#000", (0, 0, 0)), ("#FfFfFf", (255, 255, 255)), ("#102030", (16, 32, 48))]:
            self.assertEqual(parse_color(t), r, t)
    def test_invalid(self):
        for t in ["", "ff8000", "#", "#ab", "#abcd", "#abcde", "#abcdef0", "#ggg", " #abc", "#abc "]:
            with self.assertRaises(ValueError, msg=t): parse_color(t)
`, `import re
def parse_color(text):
    if not isinstance(text, str) or not re.fullmatch(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})", text):
        raise ValueError(text)
    h = text[1:]
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
`, 'all-pass'),
  T('tr-slug', 'train', 'simple', 'slug', [], "Define slugify(text) that lowercases the text, turns every maximal run of characters that are not a-z or 0-9 into a single '-', and strips leading and trailing '-'. 'Hello, World!' -> 'hello-world', '  A  B  ' -> 'a-b', '' -> ''.", `class H(unittest.TestCase):
    def test(self):
        for t, r in [("Hello, World!", "hello-world"), ("  A  B  ", "a-b"), ("", ""), ("Already-slug", "already-slug"), ("x__y--z", "x-y-z"), ("2024 Q1 Report", "2024-q1-report"), ("!!!", "")]:
            self.assertEqual(slugify(t), r, t)
`, `def slugify(text):
    out, dash = [], False
    for c in text.lower():
        if "a" <= c <= "z" or "0" <= c <= "9":
            if dash and out:
                out.append("-")
            out.append(c); dash = False
        else:
            dash = True
    return "".join(out)
`),
  T('tr-csvline', 'train', 'intermediate', 'csvline', [], 'Define split_csv_line(line) returning the list of fields of one CSV line. Fields are separated by commas. A field may be enclosed in double quotes; inside quotes a comma is literal and two double quotes "" stand for one double quote. Unquoted fields are returned as written (no trimming). An empty line has one empty field. A quote that is never closed must raise ValueError.', `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(split_csv_line('a,b,c'), ['a', 'b', 'c'])
        self.assertEqual(split_csv_line(''), [''])
        self.assertEqual(split_csv_line('a,,c'), ['a', '', 'c'])
        self.assertEqual(split_csv_line('"x,y",z'), ['x,y', 'z'])
        self.assertEqual(split_csv_line('"say ""hi""",2'), ['say "hi"', '2'])
        self.assertEqual(split_csv_line(' a , b'), [' a ', ' b'])
        with self.assertRaises(ValueError): split_csv_line('"open,field')
`, `def split_csv_line(line):
    fields, cur, i, quoted = [], [], 0, False
    while i < len(line):
        c = line[i]
        if quoted:
            if c == '"':
                if i + 1 < len(line) and line[i + 1] == '"':
                    cur.append('"'); i += 1
                else:
                    quoted = False
            else:
                cur.append(c)
        elif c == '"':
            quoted = True
        elif c == ',':
            fields.append("".join(cur)); cur = []
        else:
            cur.append(c)
        i += 1
    if quoted:
        raise ValueError("unterminated quote")
    fields.append("".join(cur))
    return fields
`),
  T('tr-intervals', 'train', 'intermediate', 'intervals', [], 'Define merge_intervals(pairs) taking a list of (start, end) integer pairs with start <= end and returning a new list of tuples, sorted by start, in which overlapping or touching intervals (one ends where the next starts) are merged into one. An empty list gives an empty list. A pair with start > end must raise ValueError.', `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(merge_intervals([]), [])
        self.assertEqual(merge_intervals([(1, 3), (2, 6), (8, 10)]), [(1, 6), (8, 10)])
        self.assertEqual(merge_intervals([(5, 7), (1, 2), (2, 4)]), [(1, 4), (5, 7)])
        self.assertEqual(merge_intervals([(1, 10), (2, 3)]), [(1, 10)])
        self.assertEqual(merge_intervals([(4, 4)]), [(4, 4)])
        with self.assertRaises(ValueError): merge_intervals([(3, 1)])
`, `def merge_intervals(pairs):
    for s, e in pairs:
        if s > e:
            raise ValueError((s, e))
    out = []
    for s, e in sorted(pairs):
        if out and s <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], e))
        else:
            out.append((s, e))
    return out
`),
  T('tr-median', 'train', 'debugging', 'median', [], `median(xs) should return the median of a non-empty list of numbers (the middle value of the sorted list, or the mean of the two middle values for an even length) without modifying xs, and raise ValueError for an empty list. It does not sort, is wrong for even lengths and crashes on an empty list. Fix it.
def median(xs):
    return xs[len(xs) // 2]`, `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(median([3, 1, 2]), 2); self.assertEqual(median([4, 1, 3, 2]), 2.5); self.assertEqual(median([7]), 7)
        xs = [5, 3, 9]; median(xs); self.assertEqual(xs, [5, 3, 9])
        with self.assertRaises(ValueError): median([])
`, `def median(xs):
    if not xs:
        raise ValueError("empty")
    s = sorted(xs); n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
`),
  T('tr-caesar', 'train', 'debugging', 'caesar', [], `caesar(text, shift) should shift every letter by shift positions in the alphabet, wrapping around (z+1 is a), keeping its case, and leave every other character unchanged; shift may be negative or larger than 26. It does not wrap, shifts non-letters and loses case. Fix it.
def caesar(text, shift):
    return "".join(chr(ord(c.lower()) + shift) for c in text)`, `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(caesar("abc", 1), "bcd"); self.assertEqual(caesar("xyz", 3), "abc"); self.assertEqual(caesar("Hello, World!", 13), "Uryyb, Jbeyq!")
        self.assertEqual(caesar("abc", -1), "zab"); self.assertEqual(caesar("Abc", 27), "Bcd"); self.assertEqual(caesar("", 5), "")
`, `def caesar(text, shift):
    out = []
    for c in text:
        if "a" <= c <= "z":
            out.append(chr((ord(c) - 97 + shift) % 26 + 97))
        elif "A" <= c <= "Z":
            out.append(chr((ord(c) - 65 + shift) % 26 + 65))
        else:
            out.append(c)
    return "".join(out)
`),
  T('tr-library', 'train', 'planning', 'library', [], 'Plan and implement class Library with: add_book(isbn, copies=1) adding copies of a book (copies must be a positive int, else ValueError; adding an existing isbn adds to its copies); available(isbn) returning how many copies are on the shelf (KeyError for an unknown isbn); checkout(isbn, member) lending one copy to member (KeyError for an unknown isbn; ValueError if no copy is on the shelf or the member already holds this isbn); return_book(isbn, member) putting it back (KeyError for an unknown isbn; ValueError if the member does not hold it).', `class H(unittest.TestCase):
    def test(self):
        lib = Library(); lib.add_book("111", 2); lib.add_book("111"); self.assertEqual(lib.available("111"), 3)
        lib.checkout("111", "ann"); self.assertEqual(lib.available("111"), 2)
        with self.assertRaises(ValueError): lib.checkout("111", "ann")
        lib.return_book("111", "ann"); self.assertEqual(lib.available("111"), 3)
        with self.assertRaises(ValueError): lib.return_book("111", "ann")
        with self.assertRaises(KeyError): lib.available("999")
        with self.assertRaises(KeyError): lib.checkout("999", "ann")
        with self.assertRaises(ValueError): lib.add_book("222", 0)
        lib.add_book("333"); lib.checkout("333", "bob")
        with self.assertRaises(ValueError): lib.checkout("333", "cat")
`, `class Library:
    def __init__(self):
        self.shelf, self.loans = {}, set()
    def add_book(self, isbn, copies=1):
        if not isinstance(copies, int) or isinstance(copies, bool) or copies < 1:
            raise ValueError(copies)
        self.shelf[isbn] = self.shelf.get(isbn, 0) + copies
    def available(self, isbn):
        return self.shelf[isbn]
    def checkout(self, isbn, member):
        if isbn not in self.shelf:
            raise KeyError(isbn)
        if self.shelf[isbn] < 1 or (isbn, member) in self.loans:
            raise ValueError(isbn)
        self.shelf[isbn] -= 1; self.loans.add((isbn, member))
    def return_book(self, isbn, member):
        if isbn not in self.shelf:
            raise KeyError(isbn)
        if (isbn, member) not in self.loans:
            raise ValueError(isbn)
        self.loans.remove((isbn, member)); self.shelf[isbn] += 1
`),

  // ── QUALIFY ──────────────────────────────────────────────────────────────────────────────────────────────────────
  T('q-ipv4', 'qualify', 'strict', 'ipv4', ['re'], "Define parse_ipv4(text) returning a tuple of four ints for a dotted-decimal IPv4 address: exactly four decimal numbers 0..255 separated by single dots, each written without leading zeros unless it is exactly 0, with no signs or spaces. '192.168.0.1' -> (192, 168, 0, 1), '0.0.0.0' -> (0, 0, 0, 0). Any other string (empty, wrong number of parts, empty part, a number above 255, a leading zero, letters, signs, spaces) must raise ValueError.", `class H(unittest.TestCase):
    def test_valid(self):
        for t, r in [("192.168.0.1", (192, 168, 0, 1)), ("0.0.0.0", (0, 0, 0, 0)), ("255.255.255.255", (255, 255, 255, 255)), ("10.0.20.3", (10, 0, 20, 3))]:
            self.assertEqual(parse_ipv4(t), r, t)
    def test_invalid(self):
        for t in ["", "1.2.3", "1.2.3.4.5", "1..3.4", "256.1.1.1", "01.2.3.4", "1.2.3.a", "-1.2.3.4", " 1.2.3.4", "1.2.3.4 ", "1.2.3."]:
            with self.assertRaises(ValueError, msg=t): parse_ipv4(t)
`, `import re
def parse_ipv4(text):
    if not isinstance(text, str):
        raise ValueError(text)
    parts = text.split(".")
    if len(parts) != 4 or not all(re.fullmatch(r"0|[1-9][0-9]{0,2}", p) and int(p) <= 255 for p in parts):
        raise ValueError(text)
    return tuple(int(p) for p in parts)
`, 'all-pass'),
  T('q-luhn', 'qualify', 'simple', 'luhn', [], 'Define luhn_valid(number) for a string. Spaces are ignored. Return False if any other character is not a digit or if fewer than 2 digits remain; otherwise return True exactly when the Luhn checksum holds: from the rightmost digit, double every second digit (subtract 9 from a doubled value above 9) and the total must be divisible by 10.', `class H(unittest.TestCase):
    def test(self):
        self.assertTrue(luhn_valid("4539 3195 0343 6467")); self.assertFalse(luhn_valid("8273 1232 7352 0569"))
        self.assertTrue(luhn_valid("0 0")); self.assertFalse(luhn_valid("0")); self.assertFalse(luhn_valid(""))
        self.assertFalse(luhn_valid("059a")); self.assertTrue(luhn_valid("059")); self.assertTrue(luhn_valid("18"))
`, `def luhn_valid(number):
    digits = number.replace(" ", "")
    if len(digits) < 2 or not all("0" <= c <= "9" for c in digits):
        return False
    total = 0
    for i, c in enumerate(reversed(digits)):
        d = int(c)
        if i % 2:
            d = d * 2 - 9 if d * 2 > 9 else d * 2
        total += d
    return total % 10 == 0
`),
  T('q-flatten', 'qualify', 'intermediate', 'flatdict', [], "Define flatten_dict(d, sep='.') turning a nested dict with string keys into a flat dict: a value that is itself a non-empty dict is flattened recursively with its key joined to the inner keys by sep; an empty dict value is dropped; every other value is kept as is. The input is not modified. {'a': 1, 'b': {'c': 2, 'd': {'e': 3}}} -> {'a': 1, 'b.c': 2, 'b.d.e': 3}.", `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(flatten_dict({'a': 1, 'b': {'c': 2, 'd': {'e': 3}}}), {'a': 1, 'b.c': 2, 'b.d.e': 3})
        self.assertEqual(flatten_dict({}), {}); self.assertEqual(flatten_dict({'x': {}}), {}); self.assertEqual(flatten_dict({'x': {'y': []}}), {'x.y': []})
        self.assertEqual(flatten_dict({'a': {'b': 1}}, sep='/'), {'a/b': 1})
        d = {'a': {'b': 1}}; flatten_dict(d); self.assertEqual(d, {'a': {'b': 1}})
`, `def flatten_dict(d, sep="."):
    out = {}
    for k, v in d.items():
        if isinstance(v, dict):
            for ik, iv in flatten_dict(v, sep).items():
                out[k + sep + ik] = iv
        else:
            out[k] = v
    return out
`),
  T('q-topk', 'qualify', 'debugging', 'topk', [], `top_k(words, k) should return the k most frequent words as a list, most frequent first, breaking ties alphabetically; if there are fewer than k distinct words it returns all of them, and k < 0 must raise ValueError. It ignores ties, returns counts instead of words and accepts negative k. Fix it.
def top_k(words, k):
    counts = {}
    for w in words:
        counts[w] = counts.get(w, 0) + 1
    return sorted(counts.values(), reverse=True)[:k]`, `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(top_k(["b", "a", "b", "c", "a", "b"], 2), ["b", "a"])
        self.assertEqual(top_k(["x", "y", "z"], 2), ["x", "y"]); self.assertEqual(top_k(["q"], 5), ["q"]); self.assertEqual(top_k([], 3), [])
        self.assertEqual(top_k(["a"], 0), [])
        with self.assertRaises(ValueError): top_k(["a"], -1)
`, `def top_k(words, k):
    if k < 0:
        raise ValueError(k)
    counts = {}
    for w in words:
        counts[w] = counts.get(w, 0) + 1
    return [w for w, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))][:k]
`),

  // ── HELDOUT ──────────────────────────────────────────────────────────────────────────────────────────────────────
  T('h-time24', 'heldout', 'strict', 'clock', ['re'], "Define parse_time(text) returning the number of seconds since midnight for a 24-hour time written as HH:MM or HH:MM:SS, where HH is two digits 00..23 and MM and SS are two digits 00..59. '07:05' -> 25500, '23:59:59' -> 86399, '00:00' -> 0. Any other string (empty, one-digit fields, hour 24 or above, minute or second 60 or above, other separators, a trailing colon, more than three fields, spaces) must raise ValueError.", `class H(unittest.TestCase):
    def test_valid(self):
        for t, n in [("07:05", 25500), ("23:59:59", 86399), ("00:00", 0), ("12:00:01", 43201), ("09:30", 34200)]:
            self.assertEqual(parse_time(t), n, t)
    def test_invalid(self):
        for t in ["", "24:00", "7:05", "07:60", "07:05:60", "07:05:", "07-05", " 07:05", "07:05:00:00", "0705", "07:5"]:
            with self.assertRaises(ValueError, msg=t): parse_time(t)
`, `import re
def parse_time(text):
    m = re.fullmatch(r"([01]\\d|2[0-3]):([0-5]\\d)(?::([0-5]\\d))?", text) if isinstance(text, str) else None
    if not m:
        raise ValueError(text)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3) or 0)
`, 'all-pass'),
  T('h-money', 'heldout', 'strict', 'money', ['re'], "Define parse_money(text) returning an amount in whole cents for a dollar string: '$', then the dollars, then optionally '.' and exactly two digits of cents. The dollars are digits without a leading zero (unless they are exactly 0), written either with no commas at all or with a comma between every group of three digits counted from the right. '$5' -> 500, '$0.99' -> 99, '$1,000' -> 100000, '$1000' -> 100000, '$12,345,678.90' -> 1234567890. Any other string (empty, no '$', no dollars, a misplaced comma, a leading zero, one or three cent digits, a trailing '.', a sign, spaces) must raise ValueError.", `class H(unittest.TestCase):
    def test_valid(self):
        for t, n in [("$5", 500), ("$0.99", 99), ("$1,000", 100000), ("$1000", 100000), ("$12,345,678.90", 1234567890), ("$0", 0), ("$999,999.01", 99999901)]:
            self.assertEqual(parse_money(t), n, t)
    def test_invalid(self):
        for t in ["", "5", "$", "$1,00", "$1000,000", "$01", "$1.5", "$1.", "$-1", "$ 1", "$1,234.567", "$,123", "$1,2345"]:
            with self.assertRaises(ValueError, msg=t): parse_money(t)
`, `import re
def parse_money(text):
    m = re.fullmatch(r"\\$(0|[1-9]\\d*|[1-9]\\d{0,2}(?:,\\d{3})+)(?:\\.(\\d{2}))?", text) if isinstance(text, str) else None
    if not m:
        raise ValueError(text)
    return int(m.group(1).replace(",", "")) * 100 + int(m.group(2) or 0)
`, 'all-pass'),
  T('h-phone', 'heldout', 'strict', 'phone', ['re'], "Define normalize_phone(text) returning the 10 digits of a US phone number written in exactly one of three formats: '555-123-4567', '(555) 123-4567' (one space after the closing parenthesis) or '5551234567'. All three give '5551234567'. Any other string (empty, too few or too many digits, other separators or spacing, a country code, letters) must raise ValueError.", `class H(unittest.TestCase):
    def test_valid(self):
        for t in ["555-123-4567", "(555) 123-4567", "5551234567"]:
            self.assertEqual(normalize_phone(t), "5551234567", t)
        self.assertEqual(normalize_phone("(800) 000-0001"), "8000000001")
    def test_invalid(self):
        for t in ["", "555-1234", "555 123 4567", "(555)123-4567", "555-123-45678", "+1 555-123-4567", "abc-def-ghij", "555-1234-567", "(555) 123 4567", "55512345678", " 5551234567"]:
            with self.assertRaises(ValueError, msg=t): normalize_phone(t)
`, `import re
def normalize_phone(text):
    if not isinstance(text, str):
        raise ValueError(text)
    for pattern in (r"(\\d{3})-(\\d{3})-(\\d{4})", r"\\((\\d{3})\\) (\\d{3})-(\\d{4})", r"(\\d{3})(\\d{3})(\\d{4})"):
        m = re.fullmatch(pattern, text)
        if m:
            return "".join(m.groups())
    raise ValueError(text)
`, 'all-pass'),
  T('h-pairs', 'heldout', 'strict', 'pairs', ['re'], "Define parse_pairs(text) returning a dict from a string of one or more key=value pairs separated by ';'. A key is a lowercase letter or underscore followed by lowercase letters, digits or underscores; a value is one or more characters that are not ';', '=' or whitespace. 'a=1;b_2=x' -> {'a': '1', 'b_2': 'x'}. Any other string (empty, a missing key or value, a repeated key, an empty pair, a leading or trailing ';', whitespace, an invalid key) must raise ValueError.", `class H(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(parse_pairs("a=1;b_2=x"), {"a": "1", "b_2": "x"}); self.assertEqual(parse_pairs("_k=v"), {"_k": "v"})
        self.assertEqual(parse_pairs("x=1"), {"x": "1"}); self.assertEqual(parse_pairs("k=a.b:c"), {"k": "a.b:c"})
    def test_invalid(self):
        for t in ["", "a", "a=", "=1", "a=1;a=2", "a=1;;b=2", ";a=1", "a=1;", "a = 1", "A=1", "1a=2", "a=1=2", "a=b c"]:
            with self.assertRaises(ValueError, msg=t): parse_pairs(t)
`, `import re
def parse_pairs(text):
    if not isinstance(text, str) or not text:
        raise ValueError(text)
    out = {}
    for part in text.split(";"):
        m = re.fullmatch(r"([a-z_][a-z0-9_]*)=([^;=\\s]+)", part)
        if not m or m.group(1) in out:
            raise ValueError(text)
        out[m.group(1)] = m.group(2)
    return out
`, 'all-pass'),
  T('h-rpn', 'heldout', 'intermediate', 'rpn', [], "Define eval_rpn(tokens) evaluating a list of string tokens in reverse Polish notation. A token is an integer (optionally with a leading '-', e.g. '-3') or one of the operators + - * /, where / is integer division truncating toward zero (7 / -2 is -3). Return the single resulting int. An unknown token, an operator without two operands, or more than one value left at the end must raise ValueError; division by zero must raise ZeroDivisionError.", `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(eval_rpn(["2", "3", "+"]), 5); self.assertEqual(eval_rpn(["4", "2", "5", "*", "+", "1", "-"]), 13)
        self.assertEqual(eval_rpn(["7", "-2", "/"]), -3); self.assertEqual(eval_rpn(["-7", "2", "/"]), -3); self.assertEqual(eval_rpn(["9"]), 9)
        for bad in [["+"], ["1", "+"], ["1", "2"], ["1", "x", "+"], []]:
            with self.assertRaises(ValueError, msg=bad): eval_rpn(bad)
        with self.assertRaises(ZeroDivisionError): eval_rpn(["1", "0", "/"])
`, `def eval_rpn(tokens):
    stack = []
    for t in tokens:
        if t in ("+", "-", "*", "/"):
            if len(stack) < 2:
                raise ValueError(t)
            b, a = stack.pop(), stack.pop()
            if t == "+": stack.append(a + b)
            elif t == "-": stack.append(a - b)
            elif t == "*": stack.append(a * b)
            else:
                if b == 0:
                    raise ZeroDivisionError()
                q = abs(a) // abs(b)
                stack.append(q if (a >= 0) == (b >= 0) else -q)
        else:
            body = t[1:] if t.startswith("-") else t
            if not body.isdigit():
                raise ValueError(t)
            stack.append(int(t))
    if len(stack) != 1:
        raise ValueError(tokens)
    return stack[0]
`),
  T('h-winmax', 'heldout', 'intermediate', 'winmax', [], 'Define max_sliding(xs, k) returning the list of maxima of every contiguous window of length k in the list xs, from left to right. max_sliding([1, 3, 2, 5, 4], 2) -> [3, 3, 5, 5]. If k < 1 or k > len(xs) it must raise ValueError (so an empty list always raises).', `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(max_sliding([1, 3, 2, 5, 4], 2), [3, 3, 5, 5]); self.assertEqual(max_sliding([4, 2, 1], 3), [4]); self.assertEqual(max_sliding([4, 2, 1], 1), [4, 2, 1])
        self.assertEqual(max_sliding([2, 2, 2], 2), [2, 2]); self.assertEqual(max_sliding([-1, -5, -3], 2), [-1, -3])
        for xs, k in [([1, 2], 0), ([1, 2], 3), ([], 1), ([1], -1)]:
            with self.assertRaises(ValueError, msg=(xs, k)): max_sliding(xs, k)
`, `def max_sliding(xs, k):
    if k < 1 or k > len(xs):
        raise ValueError(k)
    return [max(xs[i:i + k]) for i in range(len(xs) - k + 1)]
`),
  T('h-topo', 'heldout', 'intermediate', 'topo', [], "Define topo_order(deps) where deps maps each node (a string) to a list of nodes it depends on. Return a list of every node (including nodes that appear only as dependencies) in which each node comes after all of its dependencies; whenever several nodes are ready, take them in alphabetical order. A dependency cycle must raise ValueError. topo_order({'b': ['a'], 'c': ['a', 'b']}) -> ['a', 'b', 'c'].", `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(topo_order({'b': ['a'], 'c': ['a', 'b']}), ['a', 'b', 'c']); self.assertEqual(topo_order({}), [])
        self.assertEqual(topo_order({'z': [], 'y': [], 'x': ['z']}), ['y', 'z', 'x']); self.assertEqual(topo_order({'d': ['c'], 'b': []}), ['b', 'c', 'd'])
        with self.assertRaises(ValueError): topo_order({'a': ['b'], 'b': ['a']})
        with self.assertRaises(ValueError): topo_order({'a': ['a']})
`, `def topo_order(deps):
    nodes = set(deps) | {d for ds in deps.values() for d in ds}
    need = {n: set(deps.get(n, [])) for n in nodes}
    order = []
    while need:
        ready = sorted(n for n, ds in need.items() if not ds)
        if not ready:
            raise ValueError("cycle")
        n = ready[0]
        order.append(n); del need[n]
        for ds in need.values():
            ds.discard(n)
    return order
`),
  T('h-rotate', 'heldout', 'debugging', 'rotate', [], `rotate(xs, k) should return a new list with the elements of xs rotated right by k positions (a negative k rotates left, and k may be larger than the length); an empty list gives an empty list and xs is not modified. It fails for k larger than the length, rotates the wrong way for negative k and crashes on an empty list. Fix it.
def rotate(xs, k):
    return xs[-k:] + xs[:-k] if k > 0 else xs[k:] + xs[:k] if k < len(xs) else xs[len(xs) % k:]`, `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(rotate([1, 2, 3, 4], 1), [4, 1, 2, 3]); self.assertEqual(rotate([1, 2, 3, 4], 6), [3, 4, 1, 2]); self.assertEqual(rotate([1, 2, 3, 4], -1), [2, 3, 4, 1])
        self.assertEqual(rotate([1, 2, 3], 0), [1, 2, 3]); self.assertEqual(rotate([], 3), []); self.assertEqual(rotate([1, 2, 3], -4), [2, 3, 1])
        xs = [1, 2]; ys = rotate(xs, 1); self.assertEqual(xs, [1, 2]); self.assertIsNot(ys, xs)
`, `def rotate(xs, k):
    if not xs:
        return []
    k %= len(xs)
    return xs[-k:] + xs[:-k] if k else list(xs)
`),
  T('h-palin', 'heldout', 'debugging', 'palin', [], `is_palindrome(s) should return True when s reads the same forwards and backwards after lowercasing it and keeping only the letters a-z and digits 0-9 (so an empty string, or one with no letters or digits, is a palindrome). It compares the raw string, so case, spaces and punctuation break it. Fix it.
def is_palindrome(s):
    return s == s[::-1]`, `class H(unittest.TestCase):
    def test(self):
        self.assertTrue(is_palindrome("A man, a plan, a canal: Panama")); self.assertTrue(is_palindrome("")); self.assertTrue(is_palindrome("!!"))
        self.assertFalse(is_palindrome("race a car")); self.assertTrue(is_palindrome("No 'x' in Nixon")); self.assertFalse(is_palindrome("0P"))
        self.assertTrue(is_palindrome("12321")); self.assertFalse(is_palindrome("ab"))
`, `def is_palindrome(s):
    t = [c for c in s.lower() if "a" <= c <= "z" or "0" <= c <= "9"]
    return t == t[::-1]
`),
  T('h-wavg', 'heldout', 'debugging', 'wavg', [], `weighted_average(values, weights) should return sum(v * w) / sum(w) for two lists of numbers of equal length. It must raise ValueError when the lists are empty, have different lengths, contain a negative weight, or the weights sum to 0. It divides by the number of values instead of the total weight and checks nothing. Fix it.
def weighted_average(values, weights):
    return sum(v * w for v, w in zip(values, weights)) / len(values)`, `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(weighted_average([1, 2, 3], [1, 1, 2]), 2.25); self.assertEqual(weighted_average([10], [3]), 10); self.assertEqual(weighted_average([4, 8], [0, 2]), 8)
        for v, w in [([], []), ([1, 2], [1]), ([1, 2], [1, -1]), ([1, 2], [0, 0])]:
            with self.assertRaises(ValueError, msg=(v, w)): weighted_average(v, w)
`, `def weighted_average(values, weights):
    if not values or len(values) != len(weights) or any(w < 0 for w in weights):
        raise ValueError("invalid input")
    total = sum(weights)
    if total == 0:
        raise ValueError("zero weight")
    return sum(v * w for v, w in zip(values, weights)) / total
`),
  T('h-parking', 'heldout', 'planning', 'parking', [], 'Plan and implement class ParkingLot(capacity) where capacity must be an int >= 1 (else ValueError). park(plate) puts the car in the lowest-numbered free spot (spots are numbered 1..capacity) and returns that number; it raises ValueError if the lot is full or that plate is already parked. leave(plate) frees its spot and returns the spot number (KeyError if the plate is not parked). spot_of(plate) returns the spot number or None. free() returns the number of free spots.', `class H(unittest.TestCase):
    def test(self):
        lot = ParkingLot(2); self.assertEqual(lot.free(), 2); self.assertEqual(lot.park("A"), 1); self.assertEqual(lot.park("B"), 2)
        with self.assertRaises(ValueError): lot.park("C")
        self.assertEqual(lot.leave("A"), 1); self.assertIsNone(lot.spot_of("A")); self.assertEqual(lot.park("C"), 1); self.assertEqual(lot.spot_of("C"), 1)
        with self.assertRaises(ValueError): lot.park("C")
        with self.assertRaises(KeyError): lot.leave("Z")
        self.assertEqual(lot.free(), 0)
        with self.assertRaises(ValueError): ParkingLot(0)
`, `class ParkingLot:
    def __init__(self, capacity):
        if not isinstance(capacity, int) or isinstance(capacity, bool) or capacity < 1:
            raise ValueError(capacity)
        self.capacity, self.spots = capacity, {}
    def park(self, plate):
        if plate in self.spots or len(self.spots) >= self.capacity:
            raise ValueError(plate)
        used = set(self.spots.values())
        spot = next(i for i in range(1, self.capacity + 1) if i not in used)
        self.spots[plate] = spot
        return spot
    def leave(self, plate):
        return self.spots.pop(plate)
    def spot_of(self, plate):
        return self.spots.get(plate)
    def free(self):
        return self.capacity - len(self.spots)
`),
  T('h-ttlcache', 'heldout', 'planning', 'ttlcache', [], 'Plan and implement class TTLCache(ttl) where ttl is a positive number of seconds (ttl <= 0 raises ValueError). set(key, value, now) stores value at time now, replacing any earlier entry for key. get(key, now) returns the stored value, or None if the key was never set or has expired; an entry set at time t expires at time t + ttl (so get at exactly t + ttl returns None). size(now) returns how many entries have not expired at time now. Times are numbers passed in by the caller.', `class H(unittest.TestCase):
    def test(self):
        c = TTLCache(10); c.set("a", 1, 0); self.assertEqual(c.get("a", 9.5), 1); self.assertIsNone(c.get("a", 10)); self.assertIsNone(c.get("b", 0))
        c.set("a", 2, 5); self.assertEqual(c.get("a", 14), 2); c.set("b", 3, 6); self.assertEqual(c.size(7), 2); self.assertEqual(c.size(15), 1); self.assertEqual(c.size(16), 0)
        with self.assertRaises(ValueError): TTLCache(0)
        with self.assertRaises(ValueError): TTLCache(-1)
`, `class TTLCache:
    def __init__(self, ttl):
        if ttl <= 0:
            raise ValueError(ttl)
        self.ttl, self.items = ttl, {}
    def set(self, key, value, now):
        self.items[key] = (value, now + self.ttl)
    def get(self, key, now):
        item = self.items.get(key)
        return item[0] if item and now < item[1] else None
    def size(self, now):
        return sum(1 for _, exp in self.items.values() if now < exp)
`),
];

export const split = name => S2_TASKS.filter(t => t.split === name);
