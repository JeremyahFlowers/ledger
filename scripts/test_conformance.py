#!/usr/bin/env python3
"""Checks that scripts/featurize.py and js/featurize.js agree exactly.

    test_conformance.py

Where this fits: the model is trained on features produced by the Python
featurizer and evaluated in the browser on features produced by the JS one. If
those two ever disagree, the browser silently scores a document the model was
never trained to read — predictions degrade and, worse, the explanations point
at the wrong spans. Nothing else in the pipeline would notice.

The test runs both implementations over the same fixtures and compares the full
output: plain text, region cover, and every feature with its spans.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import featurize as PY  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
JS_FEATURIZE = ROOT / "js" / "featurize.js"

FIXTURES = {
    "leetcode-html": (
        "<p>Given a string <code>s</code>, find the length of the <strong>longest</strong> "
        "<span data-keyword=\"substring\"><strong>substring</strong></span> without duplicate "
        "characters.</p>\n<p><strong class=\"example\">Example 1:</strong></p>\n"
        "<pre>\n<strong>Input:</strong> s = &quot;abcabcbb&quot;\n<strong>Output:</strong> 3\n</pre>\n"
        "<p><strong>Constraints:</strong></p>\n<ul>\n\t<li><code>0 &lt;= s.length &lt;= 5 * 10<sup>4</sup></code></li>\n"
        "\t<li><code>s</code> consists of English letters.</li>\n</ul>"
    ),
    "plain-codeforces": (
        "Vasya has n apples arranged in a row. He wants to choose a contiguous subarray "
        "with the maximum sum.\n\nInput\n\nThe first line contains an integer n.\n\n"
        "Output\n\nPrint one integer.\n\nConstraints\n\n1 <= n <= 10^5\n-10^9 <= a_i <= 10^9\n"
    ),
    "tiny-n-bitmask": (
        "Assign every task to a worker.\n\nConstraints:\n1 <= n <= 20\n1 <= cost[i][j] <= 1000\n"
    ),
    "grid": (
        "<p>Given an <code>m x n</code> grid, return the number of islands.</p>"
        "<p><strong>Constraints:</strong></p><ul><li><code>1 &lt;= m, n &lt;= 300</code></li></ul>"
    ),
    "entities": "<p>Return &quot;yes&quot; if a &lt; b &amp;&amp; b &gt; c &#39;ok&#39;&nbsp;else &quot;no&quot;.</p>",
    # Plain-text paste: headings carry content on the same line, and the
    # subscripted variables are spelled with underscores rather than <sub>.
    "pasted-plaintext": (
        "Merge every group of ranges where ranges[i] = [start_i, end_i] overlap.\n\n"
        "Example 1:\nInput: ranges = [[1,4],[3,6]]\nOutput: [[1,6]]\n"
        "Explanation: The two ranges overlap.\n\n"
        "Constraints:\n1 <= ranges.length <= 10^4\n0 <= start_i <= end_i <= 10^4\n"
    ),
    "no-constraints": "Just a bare sentence with no structure at all.",
    "empty": "",
}

JS_DRIVER = """
import { featurize } from "%s";
const fixtures = JSON.parse(process.argv[2]);
const out = {};
for (const [name, raw] of Object.entries(fixtures)) {
  const { text, regions, features } = featurize(raw);
  const feats = {};
  for (const [k, spans] of features) feats[k] = spans.map((s) => [s[0], s[1], s[2]]);
  out[name] = { text, regions: regions.map((r) => [r[0], r[1], r[2]]), features: feats };
}
process.stdout.write(JSON.stringify(out));
"""


def python_side():
    out = {}
    for name, raw in FIXTURES.items():
        text, regions, feats = PY.featurize(raw)
        out[name] = {
            "text": text,
            "regions": [[r, s, e] for r, s, e in regions],
            "features": {k: [[a, b, c] for a, b, c in v] for k, v in feats.items()},
        }
    return out


def js_side():
    driver = ROOT / "scripts" / "_conformance_driver.mjs"
    driver.write_text(JS_DRIVER % JS_FEATURIZE.as_posix())
    try:
        proc = subprocess.run(
            ["node", str(driver), json.dumps(FIXTURES)],
            capture_output=True, text=True, timeout=60,
        )
        if proc.returncode != 0:
            raise SystemExit(f"node failed:\n{proc.stderr}")
        return json.loads(proc.stdout)
    finally:
        driver.unlink(missing_ok=True)


def compare(py, js):
    failures = []
    for name in FIXTURES:
        p, j = py[name], js[name]
        if p["text"] != j["text"]:
            failures.append(f"[{name}] text differs\n  py={p['text']!r}\n  js={j['text']!r}")
            continue
        if p["regions"] != j["regions"]:
            failures.append(f"[{name}] regions differ\n  py={p['regions']}\n  js={j['regions']}")
        pf, jf = p["features"], j["features"]
        only_py = sorted(set(pf) - set(jf))
        only_js = sorted(set(jf) - set(pf))
        if only_py:
            failures.append(f"[{name}] {len(only_py)} features only in python, e.g. {only_py[:6]}")
        if only_js:
            failures.append(f"[{name}] {len(only_js)} features only in js, e.g. {only_js[:6]}")
        for k in sorted(set(pf) & set(jf)):
            if pf[k] != jf[k]:
                failures.append(f"[{name}] spans differ for {k!r}\n  py={pf[k]}\n  js={jf[k]}")
    return failures


def main():
    py = python_side()
    js = js_side()
    failures = compare(py, js)

    total_feats = sum(len(v["features"]) for v in py.values())
    if failures:
        print(f"CONFORMANCE FAILED ({len(failures)} difference groups)\n")
        for f in failures[:25]:
            print(f"  {f}")
        if len(failures) > 25:
            print(f"  ... and {len(failures) - 25} more")
        raise SystemExit(1)
    print(f"conformance OK — {len(FIXTURES)} fixtures, {total_feats} features, "
          "python and js agree on text, regions and every span")


if __name__ == "__main__":
    main()
