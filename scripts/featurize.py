#!/usr/bin/env python3
"""Turns a raw problem statement into named features, with the span of text
each feature came from.

Where this fits: used by train_model.py to build the training matrix, and
mirrored exactly by js/featurize.js at inference time in the browser.

IMPORTANT — train/serve skew: this module and js/featurize.js must
produce identical output for identical input. They are deliberately written
as mechanical translations of each other, and scripts/test_conformance.py
checks them against shared fixtures. Change one, change both, then run that
test; a silent divergence would make the browser's explanations describe a
model that was never trained.

Two design decisions worth stating:

1. Features carry spans. An n-gram isn't just "contiguous subarray" — it's
   that phrase at characters 48-67, inside the statement region. The
   explanation UI needs those offsets to highlight text, and a linear model
   makes each span's contribution exactly weight x count, so the highlight is
   the real reason rather than an approximation of it.

2. Constraint bounds are parsed, not scraped. An early prototype took the
   largest integer anywhere in the text, which happily read "40 tournaments"
   as an input bound and put only 4 of 347 problems in the "n is tiny" bucket.
   Bounds are now matched only inside the constraints region and bound to a
   variable name, then split into size-like bounds (how big is the input —
   drives complexity class) and value-like bounds (how big are the elements —
   hints at counting/bit tricks).
"""
import html
import re

# ---------- region segmentation ----------

REGIONS = ("statement", "example", "constraints")

# LeetCode wraps examples in <pre> and prefixes the constraints list with a
# bolded "Constraints:". Codeforces/CodeChef plain text uses bare headings.
_HEADING_RE = re.compile(
    r"^\s*(input|output|constraints?|examples?|explanation|note|sample input|sample output)\s*:?\s*$",
    re.I | re.M,
)
_CONSTRAINT_HEADING_RE = re.compile(r"constraints?", re.I)
_EXAMPLE_HEADING_RE = re.compile(r"input|output|examples?|explanation|note|sample", re.I)

_TAG_RE = re.compile(r"<[^>]+>")
_PRE_RE = re.compile(r"<pre\b[^>]*>(.*?)</pre>", re.I | re.S)

# Inline headings — a label with content following it on the same line.
_INLINE_EXAMPLE_RE = re.compile(
    r"^[ \t]*(examples?\s*\d*|inputs?|outputs?|explanation|sample\s+(?:input|output)|note)\s*:",
    re.I | re.M,
)
_INLINE_CONSTRAINT_RE = re.compile(r"constraints?\s*:", re.I)


def to_plain(raw):
    """Convert a raw statement (LeetCode HTML or plain text) into display text
    plus region spans. Returns (text, [(region, start, end), ...]).

    The returned text is what the UI renders and what every span offset refers
    to, so stripping happens once, here, and never again downstream."""
    if "<" in raw and ">" in raw:
        text, pre_spans = _html_to_text(raw)
    else:
        text, pre_spans = raw.replace("\r\n", "\n"), []
    return text, _regions_for(text, pre_spans)


def _html_to_text(raw):
    """Strip tags, decode entities, and remember where <pre> blocks landed."""
    out = []
    pre_spans = []
    cursor = 0
    for m in _PRE_RE.finditer(raw):
        out.append(_strip(raw[cursor:m.start()]))
        start = sum(len(s) for s in out)
        out.append(_strip(m.group(1)))
        pre_spans.append((start, sum(len(s) for s in out)))
        cursor = m.end()
    out.append(_strip(raw[cursor:]))
    return "".join(out), pre_spans


def _strip(fragment):
    txt = _TAG_RE.sub(" ", fragment)
    txt = html.unescape(txt)
    txt = txt.replace("\xa0", " ")
    txt = re.sub(r"[ \t]+", " ", txt)
    return re.sub(r"\n{3,}", "\n\n", txt)


def _regions_for(text, pre_spans):
    """Label every character as statement, example, or constraints.

    Constraints win over examples where they overlap: LeetCode puts the
    constraints list after the last <pre>, and the bounds inside it are the
    single most informative thing in the whole problem."""
    spans = [("example", s, e) for s, e in pre_spans]

    for m in _HEADING_RE.finditer(text):
        label = m.group(1)
        end = _next_heading_or_end(text, m.end())
        if _CONSTRAINT_HEADING_RE.search(label):
            spans.append(("constraints", m.start(), end))
        elif _EXAMPLE_HEADING_RE.search(label):
            spans.append(("example", m.start(), end))

    # Headings that carry content on the same line, so the line-anchored
    # pattern above never sees them. Both spellings occur constantly:
    # "<strong>Constraints:</strong>" collapses to inline text once tags are
    # stripped, and a plain-text paste writes "Example 1:" or
    # "Input: nums = [1,2]". Without these, a pasted problem put its worked
    # examples in the statement region and the per-region breakdown read
    # "example: 0.00" for every plain-text problem.
    for m in _INLINE_EXAMPLE_RE.finditer(text):
        spans.append(("example", m.start(), _next_heading_or_end(text, m.end())))
    for m in _INLINE_CONSTRAINT_RE.finditer(text):
        spans.append(("constraints", m.start(), _next_heading_or_end(text, m.end())))

    return _flatten(spans, len(text))


def _next_heading_or_end(text, from_pos):
    nxt = _HEADING_RE.search(text, from_pos)
    return nxt.start() if nxt else len(text)


def _flatten(spans, length):
    """Resolve overlaps into a non-overlapping cover, constraints highest
    priority, and fill the gaps with statement."""
    priority = {"statement": 0, "example": 1, "constraints": 2}
    owner = ["statement"] * length
    for region, start, end in spans:
        for i in range(max(0, start), min(length, end)):
            if priority[region] >= priority[owner[i]]:
                owner[i] = region
    out = []
    if not length:
        return out
    cur, start = owner[0], 0
    for i in range(1, length):
        if owner[i] != cur:
            out.append((cur, start, i))
            cur, start = owner[i], i
    out.append((cur, start, length))
    return out


def region_at(regions, pos):
    for region, start, end in regions:
        if start <= pos < end:
            return region
    return "statement"


# ---------- tokenization ----------

# Subscripted identifiers must survive tokenization as one token. The same
# variable reaches us two ways: LeetCode HTML renders "start<sub>i</sub>",
# which flattens to "starti", while a plain-text paste says "start_i". Splitting
# on the underscore produced "start" plus a single letter that the length filter
# then discarded, so a pasted problem lost exactly the features the model had
# learned from the HTML — merge-intervals text ranked 5th for intervals because
# of it. Matching the underscored form and stripping the underscores makes both
# spellings land on the same token.
_TOKEN_RE = re.compile(r"[a-zA-Z]+(?:_[a-zA-Z0-9]+)*|\d+")
# Identifier-ish noise that carries no pattern signal but bloats the vocab.
STOPWORDS = frozenset("""
a an the and or of to in is are be been was were it its this that these those
for with as at by on from you your we our they their he she his her i if then
else so such can could will would should may might must do does did done have
has had not no nor but there here what which who whom when where why how all
any both each few more most other some only own same than too very s t just
""".split())


def tokenize(text, regions):
    """Lowercased alphabetic tokens with positions; integers collapse to a
    magnitude token so "10^5" and "100000" don't each claim vocabulary."""
    tokens = []
    for m in _TOKEN_RE.finditer(text):
        raw = m.group(0)
        if raw.isdigit():
            tok = f"<num{len(raw)}>"
        else:
            tok = raw.lower().replace("_", "")
            if tok in STOPWORDS or len(tok) <= 1:
                continue
        tokens.append((tok, m.start(), m.end(), region_at(regions, m.start())))
    return tokens


MAX_NGRAM = 3


def ngram_features(tokens):
    """{feature: [(start, end, region), ...]} for 1..MAX_NGRAM grams.

    An n-gram is only formed from tokens sharing a region, so a phrase never
    straddles the boundary between the statement and a constraints list."""
    feats = {}
    for n in range(1, MAX_NGRAM + 1):
        for i in range(len(tokens) - n + 1):
            window = tokens[i:i + n]
            if len({t[3] for t in window}) != 1:
                continue
            name = "w:" + " ".join(t[0] for t in window)
            feats.setdefault(name, []).append((window[0][1], window[-1][2], window[0][3]))
    return feats


# ---------- constraint parsing ----------

# A number literal: 2000, 10^5, 10 ** 5, 1e9. Deliberately does NOT allow bare
# whitespace between digits — an earlier version did, and greedily read
# "2000 \n 0 <= ..." as the single number 20000.
_NUM = r"-?\d+(?:\.\d+)?(?:\s*(?:\^|\*\*)\s*\d+|[eE]\+?\d+)?"
# Matches "1 <= n <= 10^5", "n ≤ 100", "0 <= nums[i] <= 10^9", "n == 20".
_BOUND_RE = re.compile(
    rf"(?:(?P<lo>{_NUM})\s*(?:<=|≤|<)\s*)?"
    r"(?P<var>[A-Za-z_][A-Za-z0-9_]*(?:\s*\[\s*[A-Za-z0-9_]+\s*\])?(?:\s*\.\s*(?:length|size|len))?)"
    rf"\s*(?:<=|≤|<|==|=)\s*(?P<hi>{_NUM})"
)
_INDEX_RE = re.compile(r"\[")
_LEN_SUFFIX_RE = re.compile(r"\.\s*(length|size|len)\s*$", re.I)
# Names that denote how much input there is rather than how large a value is.
_SIZE_WORD_RE = re.compile(r"(^|_)(n|m|k|q|len|length|size|count|total|num|rows?|cols?|columns?|nodes?|edges?|vertices)($|_)|num|count|len|size|total", re.I)


def _bound_kind(var):
    """Size-like (how much input) vs value-like (how big an element).

    The distinction matters: a size bound drives the complexity class you can
    afford, while a value bound hints at counting sorts and bit tricks. An
    inner array's arity ("prerequisites[i].length == 2") is neither, and is
    filed as a value so it cannot masquerade as a tiny input size."""
    has_index = bool(_INDEX_RE.search(var))
    has_len = bool(_LEN_SUFFIX_RE.search(var))
    if has_len and not has_index:
        return "size"
    if has_index:
        return "value"
    return "size" if _SIZE_WORD_RE.search(var) else "value"

SIZE_BUCKETS = [(20, "le20"), (100, "le100"), (1000, "le1e3"), (10000, "le1e4"),
                (100000, "le1e5"), (1000000, "le1e6")]
VALUE_BUCKETS = [(100, "le100"), (10000, "le1e4"), (10 ** 9, "le1e9")]


def _parse_number(raw):
    """Read 10^5, 10**5, 1e5, or a plain integer. Returns None if implausible."""
    s = re.sub(r"\s+", "", raw)
    m = re.fullmatch(r"(-?\d+)(?:\^|\*\*)(\d+)", s)
    if m:
        base, exp = int(m.group(1)), int(m.group(2))
        return base ** exp if exp <= 18 else None
    m = re.fullmatch(r"(-?\d+(?:\.\d+)?)[eE]\+?(\d+)", s)
    if m:
        exp = int(m.group(2))
        return int(float(m.group(1)) * 10 ** exp) if exp <= 18 else None
    if re.fullmatch(r"-?\d+", s):
        return int(s)
    return None


def _bucket(value, table, overflow):
    for limit, name in table:
        if value <= limit:
            return name
    return overflow


def constraint_features(text, regions):
    """Features from the constraints region only, split into size-like and
    value-like bounds. Returns {feature: [(start, end, 'constraints')]}."""
    feats = {}
    max_size, max_value, saw_negative = 0, 0, False
    size_span, value_span = None, None

    for region, start, end in regions:
        if region != "constraints":
            continue
        chunk = text[start:end]
        for m in _BOUND_RE.finditer(chunk):
            hi = _parse_number(m.group("hi"))
            if hi is None or hi <= 0:
                if hi is not None and hi < 0:
                    saw_negative = True
                continue
            lo_raw = m.group("lo")
            if lo_raw is not None and (lo := _parse_number(lo_raw)) is not None and lo < 0:
                saw_negative = True
            span = (start + m.start(), start + m.end(), "constraints")
            if _bound_kind(m.group("var")) == "size":
                if hi > max_size:
                    max_size, size_span = hi, span
            elif hi > max_value:
                max_value, value_span = hi, span

    if max_size:
        feats.setdefault(f"c:size:{_bucket(max_size, SIZE_BUCKETS, 'gt1e6')}", []).append(size_span)
    if max_value:
        feats.setdefault(f"c:value:{_bucket(max_value, VALUE_BUCKETS, 'gt1e9')}", []).append(value_span)
    if saw_negative:
        feats.setdefault("c:has_negative", []).append((0, 0, "constraints"))
    if not max_size and not max_value:
        feats.setdefault("c:none", []).append((0, 0, "constraints"))
    return feats


# ---------- top level ----------

def featurize(raw):
    """Full pipeline. Returns (text, regions, {feature: [(start, end, region)]})."""
    text, regions = to_plain(raw)
    tokens = tokenize(text, regions)
    feats = ngram_features(tokens)
    for name, spans in constraint_features(text, regions).items():
        feats.setdefault(name, []).extend(spans)
    return text, regions, feats


def feature_counts(raw):
    """Just {feature: count} — what the training matrix needs."""
    _, _, feats = featurize(raw)
    return {name: len(spans) for name, spans in feats.items()}
