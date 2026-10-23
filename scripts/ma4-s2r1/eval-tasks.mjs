// MA4-S2R1 evaluation suites. Written and committed BEFORE the relevance-gated retrieval was implemented or tuned and
// before any model saw these tasks; never edited after outputs are seen (the hash is pinned in
// docs/ma4-s2r1/NEW_BENCHMARK_PREREGISTRATION.md). Disjoint by module and function name from G7, the S1R4 dev set,
// the S1R2 benchmarks and every S2 split. Same shape and rules as S2/G7 so the workflow runs them unchanged.
//   DEV      — tuning of the task signature, eligibility and ranking (and the only model runs before freezing).
//   HELDOUT  — the one decisive A/B/C run. Never a tuning source.
// Hidden tests and references are host-side only: no prompt, skill or memory may contain them.
// RELEVANCE is the frozen ground truth for retrieval quality (which existing qualified skill family should apply);
// it is evaluation metadata only and never reaches the workflow, a prompt or the retrieval code.
export const S2R1_EVAL_VERSION = 'bunny-ma4-s2r1-eval-v1';

const T = (id, split, kind, module, allowedImports, spec, hidden, reference, testerRule = 'reference-validated') =>
  ({ id, split, kind, module, allowedImports, spec, hiddenTests: `import unittest\nfrom ${module} import *\n${hidden}`, reference, testerRule });

export const S2R1_TASKS = [
  // ── DEV ───────────────────────────────────────────────────────────────────────────────────────────────
  T('d-adddays', 'dev', 'strict', 'adddays', ['re', 'datetime', 'calendar'], "Define add_days(text, n) where text is a calendar date written exactly as YYYY-MM-DD (four digits, '-', two digits, '-', two digits; the date must exist under the Gregorian leap-year rules) and n is an int (bools are not ints). Return the date n days later (earlier for a negative n) in the same YYYY-MM-DD form. Raise ValueError for any other text, a non-int n, or a result outside the years 1 to 9999. add_days('2024-02-28', 1) -> '2024-02-29'.", `class H(unittest.TestCase):
    def test_valid(self):
        for t, n, r in [("2024-02-28", 1, "2024-02-29"), ("2023-02-28", 1, "2023-03-01"), ("2024-01-01", -1, "2023-12-31"), ("2000-01-01", 0, "2000-01-01"), ("2024-03-01", 366, "2025-03-02")]:
            self.assertEqual(add_days(t, n), r, (t, n))
    def test_invalid(self):
        for t, n in [("2023-02-29", 1), ("2024-1-01", 1), ("2024-01-01", 1.0), ("2024-01-01", True), ("9999-12-31", 1), (None, 1), ("2024-01-01 ", 1), ("2024-13-01", 0)]:
            with self.assertRaises(ValueError, msg=(t, n)): add_days(t, n)
`, `import re, datetime
def add_days(text, n):
    if not isinstance(text, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", text) or not isinstance(n, int) or isinstance(n, bool):
        raise ValueError(text)
    try:
        d = datetime.date(int(text[:4]), int(text[5:7]), int(text[8:])) + datetime.timedelta(days=n)
    except (ValueError, OverflowError):
        raise ValueError(text)
    return d.isoformat()
`, 'all-pass'),
  T('d-medskip', 'dev', 'simple', 'medskip', [], "Define median_ignore_none(values) returning, as a float, the median of the items of values that are not None: the middle value after sorting, or the mean of the two middle values for an even count. Raise ValueError when no numbers are left. The input list must not be modified. median_ignore_none([3, None, 1, 2]) -> 2.0.", `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(median_ignore_none([3, None, 1, 2]), 2.0); self.assertEqual(median_ignore_none([4, 1, None, 3, 2]), 2.5); self.assertEqual(median_ignore_none([None, 7]), 7.0)
        self.assertIsInstance(median_ignore_none([1, 2, 3]), float)
        xs = [3, None, 1]; median_ignore_none(xs); self.assertEqual(xs, [3, None, 1])
        for bad in [[], [None], [None, None]]:
            with self.assertRaises(ValueError): median_ignore_none(bad)
`, `def median_ignore_none(values):
    s = sorted(v for v in values if v is not None)
    if not s:
        raise ValueError("no numbers")
    n = len(s)
    return float(s[n // 2]) if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
`),
  T('d-slugpath', 'dev', 'simple', 'slugpath', ['re'], "Define slug_path(parts) that turns each string in parts into a slug (lowercase it, replace every maximal run of characters that are not a-z or 0-9 with a single '-', strip leading and trailing '-'), drops parts whose slug is empty, and joins the rest with '/'. Raise ValueError when nothing is left. slug_path(['My Docs', '', '2024 Plans!']) -> 'my-docs/2024-plans'.", `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(slug_path(["My Docs", "", "2024 Plans!"]), "my-docs/2024-plans"); self.assertEqual(slug_path(["A"]), "a"); self.assertEqual(slug_path(["--x--", "y z"]), "x/y-z")
        for bad in [[], ["", "!!"], ["   "]]:
            with self.assertRaises(ValueError): slug_path(bad)
`, `import re
def slug_path(parts):
    slugs = [s for s in (re.sub(r"[^a-z0-9]+", "-", p.lower()).strip("-") for p in parts) if s]
    if not slugs:
        raise ValueError("empty")
    return "/".join(slugs)
`),
  T('d-hhmm', 'dev', 'strict', 'hhmm', ['re'], "Define hhmm_minutes(text) for a time of day written exactly as HH:MM (two digits each; hours 00-23, minutes 00-59), returning the number of minutes since midnight as an int. Any other input, including surrounding spaces or a non-string, raises ValueError. '01:30' -> 90.", `class H(unittest.TestCase):
    def test_valid(self):
        for t, r in [("00:00", 0), ("01:30", 90), ("23:59", 1439), ("12:00", 720)]:
            self.assertEqual(hhmm_minutes(t), r, t)
    def test_invalid(self):
        for t in ["24:00", "12:60", "1:30", "01:3", "01:30 ", "", None, "01-30", "ab:cd", "01:30:00"]:
            with self.assertRaises(ValueError, msg=t): hhmm_minutes(t)
`, `import re
def hhmm_minutes(text):
    m = re.fullmatch(r"([0-9]{2}):([0-9]{2})", text) if isinstance(text, str) else None
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        raise ValueError(text)
    return int(m.group(1)) * 60 + int(m.group(2))
`, 'all-pass'),
  T('d-mean', 'dev', 'simple', 'amean', [], "Define arithmetic_mean(values) returning the arithmetic mean of a non-empty list of numbers as a float. An empty list raises ValueError. arithmetic_mean([1, 2, 6]) -> 3.0.", `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(arithmetic_mean([1, 2, 6]), 3.0); self.assertEqual(arithmetic_mean([5]), 5.0); self.assertAlmostEqual(arithmetic_mean([0.1, 0.2]), 0.15); self.assertEqual(arithmetic_mean([-2, 2]), 0.0)
        self.assertIsInstance(arithmetic_mean([2, 2]), float)
        with self.assertRaises(ValueError): arithmetic_mean([])
`, `def arithmetic_mean(values):
    if not values:
        raise ValueError("empty")
    return sum(values) / len(values)
`),
  T('d-chunksum', 'dev', 'intermediate', 'chunksum', [], "Define chunk_sums(xs, size) returning the sums of consecutive chunks of size items (the last chunk may be shorter). size must be an int >= 1 (bools are not ints), otherwise ValueError. chunk_sums([1, 2, 3, 4, 5], 2) -> [3, 7, 5]; chunk_sums([], 3) -> [].", `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(chunk_sums([1, 2, 3, 4, 5], 2), [3, 7, 5]); self.assertEqual(chunk_sums([], 3), []); self.assertEqual(chunk_sums([4], 1), [4]); self.assertEqual(chunk_sums([1, 2, 3], 5), [6])
        for bad in [0, -1, 1.5, True]:
            with self.assertRaises(ValueError): chunk_sums([1, 2], bad)
`, `def chunk_sums(xs, size):
    if not isinstance(size, int) or isinstance(size, bool) or size < 1:
        raise ValueError(size)
    return [sum(xs[i:i + size]) for i in range(0, len(xs), size)]
`),
  T('d-clamp', 'dev', 'debugging', 'clampfix', [], `clamp(x, lo, hi) should return lo when x < lo, hi when x > hi and x otherwise, and raise ValueError when lo > hi. It swaps the bounds, never raises and returns hi for values inside the range. Fix it.
def clamp(x, lo, hi):
    if x < lo:
        return hi
    if x > hi:
        return lo
    return hi`, `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(clamp(5, 0, 10), 5); self.assertEqual(clamp(-1, 0, 10), 0); self.assertEqual(clamp(11, 0, 10), 10); self.assertEqual(clamp(3, 3, 3), 3)
        with self.assertRaises(ValueError): clamp(1, 5, 0)
`, `def clamp(x, lo, hi):
    if lo > hi:
        raise ValueError((lo, hi))
    return lo if x < lo else hi if x > hi else x
`),
  T('d-wordindex', 'dev', 'planning', 'wordindex', ['re'], "Plan and implement class WordIndex(). add(doc_id, text) indexes the words of text for doc_id, where a word is a maximal run of the letters a-z after lowercasing; doc_id must be a non-empty string (ValueError otherwise) and adding the same doc_id again replaces its words. lookup(word) returns the sorted list of doc_ids containing the lowercased word. remove(doc_id) drops the document (KeyError if it was never added).", `class H(unittest.TestCase):
    def test(self):
        ix = WordIndex(); ix.add("b", "Hello world"); ix.add("a", "hello, Bunny!")
        self.assertEqual(ix.lookup("HELLO"), ["a", "b"]); self.assertEqual(ix.lookup("world"), ["b"]); self.assertEqual(ix.lookup("nope"), [])
        ix.add("b", "only bunny"); self.assertEqual(ix.lookup("world"), []); self.assertEqual(ix.lookup("bunny"), ["a", "b"])
        ix.remove("a"); self.assertEqual(ix.lookup("hello"), [])
        with self.assertRaises(KeyError): ix.remove("a")
        with self.assertRaises(ValueError): ix.add("", "x")
`, `import re
class WordIndex:
    def __init__(self):
        self.docs = {}
    def add(self, doc_id, text):
        if not isinstance(doc_id, str) or not doc_id:
            raise ValueError(doc_id)
        self.docs[doc_id] = set(re.findall(r"[a-z]+", text.lower()))
    def lookup(self, word):
        return sorted(d for d, words in self.docs.items() if word.lower() in words)
    def remove(self, doc_id):
        del self.docs[doc_id]
`),

  // ── HELDOUT ───────────────────────────────────────────────────────────────────────────────────────────
  T('h-daysbetween', 'heldout', 'strict', 'daysbetween', ['re', 'datetime', 'calendar'], "Define days_between(start, end) where start and end are calendar dates written exactly as YYYY-MM-DD (four digits, '-', two digits, '-', two digits; no spaces or other characters; the date must exist under the Gregorian leap-year rules). Return the number of days from start to end as an int (negative when end is earlier). Any other input, including a non-string, raises ValueError. days_between('2024-02-28', '2024-03-01') -> 2.", `class H(unittest.TestCase):
    def test_valid(self):
        for a, b, r in [("2024-02-28", "2024-03-01", 2), ("2023-12-31", "2024-01-01", 1), ("2024-01-01", "2023-12-31", -1), ("2000-01-01", "2000-01-01", 0), ("1999-01-01", "2000-01-01", 365), ("2000-01-01", "2001-01-01", 366)]:
            self.assertEqual(days_between(a, b), r, (a, b))
    def test_invalid(self):
        for t in ["2023-02-29", "2024-13-01", "2024-1-01", "2024-01-01 ", "", "2024/01/01", None, 20240101, "1900-02-29", "2024-01-01\\n", "2024-04-31"]:
            with self.assertRaises(ValueError, msg=t): days_between(t, "2024-01-01")
            with self.assertRaises(ValueError, msg=t): days_between("2024-01-01", t)
`, `import re, datetime
def _date(t):
    if not isinstance(t, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", t):
        raise ValueError(t)
    try:
        return datetime.date(int(t[:4]), int(t[5:7]), int(t[8:]))
    except ValueError:
        raise ValueError(t)
def days_between(start, end):
    return (_date(end) - _date(start)).days
`, 'all-pass'),
  T('h-weekday', 'heldout', 'strict', 'weekday', ['re', 'datetime', 'calendar'], "Define weekday_name(text) for a calendar date written exactly as YYYY-MM-DD (four digits, '-', two digits, '-', two digits; the date must exist under the Gregorian leap-year rules), returning the English name of its day of the week: 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' or 'Sunday'. Any other input, including a non-string, raises ValueError. weekday_name('2000-01-01') -> 'Saturday'.", `class H(unittest.TestCase):
    def test_valid(self):
        for t, r in [("2024-02-29", "Thursday"), ("2000-01-01", "Saturday"), ("2023-10-23", "Monday"), ("1970-01-01", "Thursday"), ("2024-12-25", "Wednesday")]:
            self.assertEqual(weekday_name(t), r, t)
    def test_invalid(self):
        for t in ["2023-02-29", "2024-00-10", "2024-04-31", "24-04-01", "2024-04-01T00:00", "", None, "2024-4-1", " 2024-04-01"]:
            with self.assertRaises(ValueError, msg=t): weekday_name(t)
`, `import re, datetime
NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
def weekday_name(text):
    if not isinstance(text, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", text):
        raise ValueError(text)
    try:
        d = datetime.date(int(text[:4]), int(text[5:7]), int(text[8:]))
    except ValueError:
        raise ValueError(text)
    return NAMES[d.weekday()]
`, 'all-pass'),
  T('h-mad', 'heldout', 'intermediate', 'mad', [], "Define mad(values) returning, as a float, the median absolute deviation of a non-empty list of numbers: first m = the median of values (the middle value after sorting, or the mean of the two middle values for an even count), then the median of [abs(x - m) for x in values]. An empty list raises ValueError. The input list must not be modified. mad([1, 2, 3, 4, 100]) -> 1.0.", `class H(unittest.TestCase):
    def test(self):
        for xs, r in [([1, 2, 3, 4, 100], 1.0), ([1, 2, 3, 4], 1.0), ([5], 0.0), ([0, 0, 0, 9, 9], 0.0), ([2, 4, 6, 8, 10, 12], 3.0), ([1.5, 2.5, 10.0], 1.0)]:
            self.assertAlmostEqual(mad(xs), r, msg=xs)
        self.assertIsInstance(mad([1, 2, 3]), float)
        xs = [3, 1, 2]; mad(xs); self.assertEqual(xs, [3, 1, 2])
        with self.assertRaises(ValueError): mad([])
`, `def _median(xs):
    s = sorted(xs)
    n = len(s)
    return float(s[n // 2]) if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
def mad(values):
    if not values:
        raise ValueError("empty")
    m = _median(values)
    return float(_median([abs(x - m) for x in values]))
`),
  T('h-runmed', 'heldout', 'debugging', 'runmed', [], `running_median(values) should return a list whose i-th item is the median of values[:i+1] as a float (the middle value after sorting, or the mean of the two middle values for an even count); an empty list gives [] and values is not modified. It returns wrong medians, sorts the caller's list in place and crashes on an empty list. Fix it.
def running_median(values):
    out = []
    values.sort()
    for i in range(len(values)):
        window = values[:i + 1]
        out.append(window[len(window) // 2])
    return out if out else values[0]`, `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(running_median([3, 1, 2]), [3.0, 2.0, 2.0]); self.assertEqual(running_median([5, 1, 4, 2]), [5.0, 3.0, 4.0, 3.0]); self.assertEqual(running_median([]), [])
        self.assertEqual(running_median([1.5, 2.5]), [1.5, 2.0])
        xs = [2, 1]; running_median(xs); self.assertEqual(xs, [2, 1])
`, `def running_median(values):
    out = []
    for i in range(1, len(values) + 1):
        s = sorted(values[:i])
        n = len(s)
        out.append(float(s[n // 2]) if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2)
    return out
`),
  T('h-uniqslug', 'heldout', 'intermediate', 'uniqslug', ['re'], "Define unique_slugs(titles) that turns each title into a slug (lowercase it, replace every maximal run of characters that are not a-z or 0-9 with a single '-', strip leading and trailing '-', and use 'untitled' when nothing is left) and returns the slugs in the same order, where the second occurrence of a slug becomes slug-2, the third slug-3, and so on. unique_slugs(['Hello World', 'hello-world!', '???']) -> ['hello-world', 'hello-world-2', 'untitled'].", `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(unique_slugs(["Hello World", "hello-world!", "???"]), ["hello-world", "hello-world-2", "untitled"])
        self.assertEqual(unique_slugs(["A", "a", "A!", "b"]), ["a", "a-2", "a-3", "b"]); self.assertEqual(unique_slugs([]), [])
        self.assertEqual(unique_slugs(["", "  "]), ["untitled", "untitled-2"]); self.assertEqual(unique_slugs(["Café Menu", "2024 Q1"]), ["caf-menu", "2024-q1"])
`, `import re
def unique_slugs(titles):
    seen, out = {}, []
    for t in titles:
        s = re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-") or "untitled"
        seen[s] = seen.get(s, 0) + 1
        out.append(s if seen[s] == 1 else f"{s}-{seen[s]}")
    return out
`),
  T('h-slugfile', 'heldout', 'strict', 'slugfile', ['re'], "Define slug_filename(title, ext) returning slug + '.' + ext lowercased, where slug is title lowercased with every maximal run of characters that are not a-z or 0-9 replaced by a single '-' and leading and trailing '-' stripped. Raise ValueError if title or ext is not a string, if the slug is empty, or if ext is not 1 to 5 characters that are all a-z, A-Z or 0-9. slug_filename('Q3 Report: Final!', 'PDF') -> 'q3-report-final.pdf'.", `class H(unittest.TestCase):
    def test_valid(self):
        for a, b, r in [("Q3 Report: Final!", "PDF", "q3-report-final.pdf"), ("notes", "txt", "notes.txt"), ("  Hello  ", "md", "hello.md"), ("x", "abcde", "x.abcde"), ("a_b", "Tar", "a-b.tar")]:
            self.assertEqual(slug_filename(a, b), r, (a, b))
    def test_invalid(self):
        for a, b in [("!!!", "txt"), ("", "txt"), ("a", ""), ("a", "toolong"), ("a", ".txt"), ("a", "t x"), (None, "txt"), ("a", None), ("a", "tx-t"), ("a", "ÄB")]:
            with self.assertRaises(ValueError, msg=(a, b)): slug_filename(a, b)
`, `import re
def slug_filename(title, ext):
    if not isinstance(title, str) or not isinstance(ext, str):
        raise ValueError("type")
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    if not slug or not re.fullmatch(r"[A-Za-z0-9]{1,5}", ext):
        raise ValueError("invalid")
    return f"{slug}.{ext.lower()}"
`, 'all-pass'),
  T('h-hms', 'heldout', 'strict', 'hms', ['re'], "Define hms_to_seconds(text) for a time of day written exactly as HH:MM:SS with two digits each (hours 00-23, minutes and seconds 00-59), returning the number of seconds since midnight as an int. Any other input (a different shape, out-of-range values, surrounding spaces, or a non-string) raises ValueError. '01:02:03' -> 3723.", `class H(unittest.TestCase):
    def test_valid(self):
        for t, r in [("00:00:00", 0), ("23:59:59", 86399), ("01:02:03", 3723), ("12:00:00", 43200)]:
            self.assertEqual(hms_to_seconds(t), r, t)
    def test_invalid(self):
        for t in ["24:00:00", "12:60:00", "12:00:60", "1:02:03", "01:02", "01:02:03 ", "", "01-02-03", None, "aa:bb:cc", "01:02:03:04"]:
            with self.assertRaises(ValueError, msg=t): hms_to_seconds(t)
`, `import re
def hms_to_seconds(text):
    m = re.fullmatch(r"([0-9]{2}):([0-9]{2}):([0-9]{2})", text) if isinstance(text, str) else None
    if not m:
        raise ValueError(text)
    h, mi, s = (int(g) for g in m.groups())
    if h > 23 or mi > 59 or s > 59:
        raise ValueError(text)
    return h * 3600 + mi * 60 + s
`, 'all-pass'),
  T('h-dmy', 'heldout', 'strict', 'dmy', ['re', 'calendar'], "Define parse_dmy(text) returning (year, month, day) as ints for a calendar date written exactly as DD.MM.YYYY: two digits, a dot, two digits, a dot, four digits. The date must exist (leap years follow the Gregorian rules). Any other input, including surrounding spaces or a non-string, raises ValueError. '29.02.2024' -> (2024, 2, 29).", `class H(unittest.TestCase):
    def test_valid(self):
        for t, r in [("29.02.2024", (2024, 2, 29)), ("01.01.2000", (2000, 1, 1)), ("31.12.1999", (1999, 12, 31)), ("30.04.2023", (2023, 4, 30))]:
            self.assertEqual(parse_dmy(t), r, t)
    def test_invalid(self):
        for t in ["29.02.2023", "31.04.2024", "1.1.2000", "01.13.2000", "2000.01.01", "01/01/2000", " 01.01.2000", "", None, "00.01.2000", "01.01.2000x"]:
            with self.assertRaises(ValueError, msg=t): parse_dmy(t)
`, `import re, calendar
def parse_dmy(text):
    m = re.fullmatch(r"([0-9]{2})\\.([0-9]{2})\\.([0-9]{4})", text) if isinstance(text, str) else None
    if not m:
        raise ValueError(text)
    d, mo, y = (int(g) for g in m.groups())
    if not 1 <= mo <= 12 or not 1 <= d <= calendar.monthrange(y, mo)[1]:
        raise ValueError(text)
    return (y, mo, d)
`, 'all-pass'),
  T('h-mostfreq', 'heldout', 'simple', 'mostfreq', [], "Define most_frequent(values) returning the value that occurs most often in a non-empty list of numbers; when several values tie, return the smallest of them. An empty list raises ValueError. most_frequent([3, 1, 3, 1]) -> 1.", `class H(unittest.TestCase):
    def test(self):
        for xs, r in [([1, 2, 2, 3], 2), ([3, 1, 3, 1], 1), ([5], 5), ([-1, -1, 2, 2, 0], -1), ([2.5, 2.5, 1], 2.5), ([4, 4, 4, 9, 9, 9, 1], 4)]:
            self.assertEqual(most_frequent(xs), r, xs)
        with self.assertRaises(ValueError): most_frequent([])
`, `def most_frequent(values):
    if not values:
        raise ValueError("empty")
    counts = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    best = max(counts.values())
    return min(v for v, c in counts.items() if c == best)
`),
  T('h-snake', 'heldout', 'simple', 'snake', [], "Define to_snake(name) converting a camelCase or PascalCase identifier made of ASCII letters and digits to snake_case: insert '_' before every uppercase letter that follows a lowercase letter or a digit, and before an uppercase letter that follows another uppercase letter when it is itself followed by a lowercase letter; then lowercase everything. 'parseHTTPResponse' -> 'parse_http_response', 'UserID' -> 'user_id', 'Version2Beta' -> 'version2_beta', 'already' -> 'already'.", `class H(unittest.TestCase):
    def test(self):
        for t, r in [("parseHTTPResponse", "parse_http_response"), ("UserID", "user_id"), ("Version2Beta", "version2_beta"), ("already", "already"), ("XMLParser", "xml_parser"), ("getX", "get_x"), ("A", "a"), ("", "")]:
            self.assertEqual(to_snake(t), r, t)
`, `def to_snake(name):
    out = []
    for i, c in enumerate(name):
        if c.isupper() and i > 0:
            prev, nxt = name[i - 1], name[i + 1] if i + 1 < len(name) else ""
            if prev.islower() or prev.isdigit() or (prev.isupper() and nxt.islower()):
                out.append("_")
        out.append(c.lower())
    return "".join(out)
`),
  T('h-transpose', 'heldout', 'intermediate', 'transpose', [], "Define transpose(matrix) for a matrix given as a list of rows (each row a list of numbers), returning a new list of lists whose row i is column i of the input. An empty matrix [] gives []. Raise ValueError if any row is empty or the rows do not all have the same length. The input must not be modified. transpose([[1, 2, 3], [4, 5, 6]]) -> [[1, 4], [2, 5], [3, 6]].", `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(transpose([[1, 2, 3], [4, 5, 6]]), [[1, 4], [2, 5], [3, 6]]); self.assertEqual(transpose([[1]]), [[1]]); self.assertEqual(transpose([]), []); self.assertEqual(transpose([[1], [2], [3]]), [[1, 2, 3]])
        for bad in [[[1, 2], [3]], [[]], [[1], []]]:
            with self.assertRaises(ValueError): transpose(bad)
        m = [[1, 2], [3, 4]]; t = transpose(m); self.assertEqual(m, [[1, 2], [3, 4]]); t[0][0] = 9; self.assertEqual(m[0][0], 1)
`, `def transpose(matrix):
    if not matrix:
        return []
    width = len(matrix[0])
    if width == 0 or any(len(r) != width for r in matrix):
        raise ValueError("ragged")
    return [[row[i] for row in matrix] for i in range(width)]
`),
  T('h-teamtotal', 'heldout', 'intermediate', 'teamtotal', [], "Define team_totals(rows) where rows is a list of dicts, each with exactly the keys 'team' (a non-empty string) and 'points' (an int; bools are not ints). Return a dict mapping each team to the sum of its points, with keys in order of first appearance. Raise ValueError for any row that is not such a dict. team_totals([{'team': 'a', 'points': 3}, {'team': 'b', 'points': 1}, {'team': 'a', 'points': -1}]) -> {'a': 2, 'b': 1}.", `class H(unittest.TestCase):
    def test(self):
        r = team_totals([{"team": "a", "points": 3}, {"team": "b", "points": 1}, {"team": "a", "points": -1}]); self.assertEqual(r, {"a": 2, "b": 1}); self.assertEqual(list(r), ["a", "b"])
        self.assertEqual(team_totals([]), {})
        for bad in [[{"team": "a"}], [{"team": "", "points": 1}], [{"team": "a", "points": 1.5}], [{"team": "a", "points": True}], [{"team": "a", "points": 1, "x": 0}], ["a"], [{"team": 1, "points": 1}]]:
            with self.assertRaises(ValueError, msg=bad): team_totals(bad)
`, `def team_totals(rows):
    out = {}
    for r in rows:
        if not isinstance(r, dict) or set(r) != {"team", "points"} or not isinstance(r["team"], str) or not r["team"] or not isinstance(r["points"], int) or isinstance(r["points"], bool):
            raise ValueError(r)
        out[r["team"]] = out.get(r["team"], 0) + r["points"]
    return out
`),
  T('h-gcdall', 'heldout', 'simple', 'gcdall', ['math'], "Define gcd_all(numbers) returning the greatest common divisor of a non-empty list of ints as a non-negative int (gcd_all([12, -18, 30]) -> 6, gcd_all([0, 0]) -> 0, gcd_all([7]) -> 7). Raise ValueError for an empty list or any element that is not an int (bools are not ints here).", `class H(unittest.TestCase):
    def test(self):
        for xs, r in [([12, -18, 30], 6), ([0, 0], 0), ([7], 7), ([-7], 7), ([0, 5], 5), ([17, 34, 51], 17), ([9, 28], 1)]:
            self.assertEqual(gcd_all(xs), r, xs)
        for bad in [[], [1.0], [True, 2], ["3"]]:
            with self.assertRaises(ValueError, msg=bad): gcd_all(bad)
`, `def gcd_all(numbers):
    if not numbers or any(not isinstance(n, int) or isinstance(n, bool) for n in numbers):
        raise ValueError(numbers)
    g = 0
    for n in numbers:
        a, b = g, abs(n)
        while b:
            a, b = b, a % b
        g = a
    return g
`),
  T('h-pairdiff', 'heldout', 'debugging', 'pairdiff', [], `pairwise_diffs(xs) should return [xs[1] - xs[0], xs[2] - xs[1], ...], one item shorter than xs; a list with fewer than two items gives []. It subtracts in the wrong order, drops the last difference and crashes on an empty list. Fix it.
def pairwise_diffs(xs):
    if len(xs) < 2:
        return [xs[0]]
    return [xs[i] - xs[i + 1] for i in range(len(xs) - 2)]`, `class H(unittest.TestCase):
    def test(self):
        self.assertEqual(pairwise_diffs([1, 4, 9, 16]), [3, 5, 7]); self.assertEqual(pairwise_diffs([5]), []); self.assertEqual(pairwise_diffs([]), []); self.assertEqual(pairwise_diffs([3, 1]), [-2]); self.assertEqual(pairwise_diffs([2.5, 3.0]), [0.5])
`, `def pairwise_diffs(xs):
    return [xs[i + 1] - xs[i] for i in range(len(xs) - 1)]
`),
  T('h-gradebook', 'heldout', 'planning', 'gradebook', [], "Plan and implement class Gradebook(). add(student, score) records a score for a student; student must be a non-empty string and score an int from 0 to 100 (bools are not ints), otherwise ValueError. average(student) returns the mean of that student's scores as a float (KeyError if the student has no scores). best() returns the student with the highest average (ties go to the alphabetically first name), or None when there are no scores. students() returns the sorted list of students with at least one score.", `class H(unittest.TestCase):
    def test(self):
        g = Gradebook(); self.assertIsNone(g.best()); self.assertEqual(g.students(), [])
        g.add("bo", 80); g.add("al", 90); g.add("bo", 100)
        self.assertEqual(g.average("bo"), 90.0); self.assertEqual(g.average("al"), 90.0); self.assertEqual(g.best(), "al"); self.assertEqual(g.students(), ["al", "bo"])
        g.add("cy", 95); self.assertEqual(g.best(), "cy")
        with self.assertRaises(KeyError): g.average("zz")
        for bad in [("", 50), ("x", 101), ("x", -1), ("x", 50.0), ("x", True), (None, 5)]:
            with self.assertRaises(ValueError, msg=bad): g.add(*bad)
        self.assertEqual(g.students(), ["al", "bo", "cy"])
`, `class Gradebook:
    def __init__(self):
        self.scores = {}
    def add(self, student, score):
        if not isinstance(student, str) or not student or not isinstance(score, int) or isinstance(score, bool) or not 0 <= score <= 100:
            raise ValueError((student, score))
        self.scores.setdefault(student, []).append(score)
    def average(self, student):
        s = self.scores[student]
        return sum(s) / len(s)
    def best(self):
        if not self.scores:
            return None
        return min(self.scores, key=lambda k: (-self.average(k), k))
    def students(self):
        return sorted(self.scores)
`),
  T('h-limiter', 'heldout', 'planning', 'limiter', [], "Plan and implement class SlidingWindowLimiter(limit, window) allowing at most limit events in any window of window seconds; limit must be an int >= 1 (bools are not ints) and window a positive number, otherwise ValueError. allow(now) returns True and records the event if fewer than limit recorded events lie in the half-open interval (now - window, now], otherwise it returns False and records nothing. Times passed to allow never decrease. remaining(now) returns how many more events would be allowed at time now.", `class H(unittest.TestCase):
    def test(self):
        r = SlidingWindowLimiter(2, 10)
        self.assertTrue(r.allow(0)); self.assertTrue(r.allow(1)); self.assertFalse(r.allow(5)); self.assertEqual(r.remaining(5), 0)
        self.assertTrue(r.allow(10)); self.assertFalse(r.allow(10.5)); self.assertEqual(r.remaining(11), 1); self.assertTrue(r.allow(11))
        self.assertEqual(r.remaining(20.5), 1); self.assertEqual(r.remaining(21), 2)
        for bad in [(0, 10), (1, 0), (1, -5), (1.5, 10), (True, 10)]:
            with self.assertRaises(ValueError, msg=bad): SlidingWindowLimiter(*bad)
`, `class SlidingWindowLimiter:
    def __init__(self, limit, window):
        if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1 or isinstance(window, bool) or not isinstance(window, (int, float)) or window <= 0:
            raise ValueError((limit, window))
        self.limit, self.window, self.events = limit, window, []
    def _count(self, now):
        return sum(1 for t in self.events if now - self.window < t <= now)
    def allow(self, now):
        if self._count(now) >= self.limit:
            return False
        self.events.append(now)
        return True
    def remaining(self, now):
        return self.limit - self._count(now)
`),
];

/** Frozen retrieval ground truth: the qualified-skill family that should apply, or why none should. */
export const RELEVANCE = Object.freeze({
  'd-adddays': { relation: 'applicable', family: 'date-iso' }, 'd-medskip': { relation: 'applicable', family: 'median' }, 'd-slugpath': { relation: 'applicable', family: 'slug' },
  'd-hhmm': { relation: 'near-miss', family: 'date-iso' }, 'd-mean': { relation: 'near-miss', family: 'median' }, 'd-chunksum': { relation: 'none' }, 'd-clamp': { relation: 'none' }, 'd-wordindex': { relation: 'none' },
  'h-daysbetween': { relation: 'applicable', family: 'date-iso' }, 'h-weekday': { relation: 'applicable', family: 'date-iso' }, 'h-mad': { relation: 'applicable', family: 'median' },
  'h-runmed': { relation: 'applicable', family: 'median' }, 'h-uniqslug': { relation: 'applicable', family: 'slug' }, 'h-slugfile': { relation: 'applicable', family: 'slug' },
  'h-hms': { relation: 'near-miss', family: 'date-iso' }, 'h-dmy': { relation: 'near-miss', family: 'date-iso' }, 'h-mostfreq': { relation: 'near-miss', family: 'median' }, 'h-snake': { relation: 'near-miss', family: 'slug' },
  'h-transpose': { relation: 'none' }, 'h-teamtotal': { relation: 'none' }, 'h-gcdall': { relation: 'none' }, 'h-pairdiff': { relation: 'none' }, 'h-gradebook': { relation: 'none' }, 'h-limiter': { relation: 'none' },
});

export const split = name => S2R1_TASKS.filter(t => t.split === name);
