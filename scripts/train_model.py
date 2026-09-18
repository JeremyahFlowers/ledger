#!/usr/bin/env python3
"""Trains the pattern classifier and emits the artifact the browser runs.

    train_model.py            # train, evaluate, write model/pattern-model.json
    train_model.py --report   # evaluate and print metrics without writing

Where this fits: second stage of the pipeline. Reads data/corpus.jsonl from
build_corpus.py, writes model/pattern-model.json, which js/pattern-model.js
loads and evaluates in the browser.

Why a linear model, deliberately:

* Its explanations are faithful by construction. A prediction is
  sum(weight[f] * x[f]) + b, so the contribution of a phrase IS
  weight x value — not a post-hoc approximation of it like attention rollout
  or a surrogate fit. When the UI highlights "contiguous subarray" as the
  reason, that is arithmetic, not storytelling.
* It ships as JSON and runs as a sparse dot product: no ONNX, no WASM, no
  model download measured in tens of megabytes.
* Counterfactuals are exact and instant — zero out a phrase's features,
  recompute, and you have a true "without this, the answer becomes X".

One-vs-rest rather than softmax across patterns, because a problem genuinely
can be two patterns at once (sliding window AND hash map), and because it lets
a problem be *none* of them — the corpus deliberately contains math and
geometry problems that are negatives for every class.

Three-way labels per pattern: weight >= POSITIVE_THRESHOLD is positive, weight
of zero is negative, and anything in between is dropped from that pattern's
training set. See taxonomy.POSITIVE_THRESHOLD.
"""
import argparse
import json
import math
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from scipy.sparse import csr_matrix
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.metrics import roc_auc_score, precision_recall_fscore_support

sys.path.insert(0, str(Path(__file__).parent))
import taxonomy  # noqa: E402
from featurize import feature_counts  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / "data" / "corpus.jsonl"
MODEL_OUT = ROOT / "model" / "pattern-model.json"

MIN_DOC_FREQ = 4          # a feature seen in <4 problems is memorizing, not learning
MAX_FEATURES_PER_PATTERN = 1200   # pruning keeps the artifact small and explanations focused
REGULARIZATION_C = 2.0
CV_FOLDS = 5

# A pattern ships a live prediction only if it clears both bars. Below them the
# app still lists catalog problems for the pattern, but says plainly that it
# cannot explain an unseen problem in terms of it — better than a confident
# guess from 3 training examples.
MIN_POSITIVES = 25
MIN_AUC = 0.70

# Decision threshold per pattern is tuned on CV predictions rather than fixed at
# 0.5, because the classes are very imbalanced and 0.5 is rarely the useful cut.
#
# We target a precision floor directly rather than maximizing an F-score and
# hoping precision lands somewhere acceptable. It didn't: an F0.5-tuned build
# fired at least one confident pattern on 24.5% of problems that are genuinely
# none of our 23 — greedy and recursion-dp alone accounted for 98 of 126, being
# the broadest classes with the weakest precision. A tool whose output is an
# explanation has to be quiet when it doesn't know; a wrong confident answer
# teaches the wrong lesson and costs trust that recall can't buy back.
#
# So: among thresholds reaching TARGET_PRECISION on held-out predictions, take
# the one with the best recall. A pattern that can never reach it still ships,
# with its real precision recorded, and the UI presents it as a weak signal.
#
# 0.65 was measured, not guessed. Sweeping the target produced a smooth trade
# with no sweet spot -- mean recall / false-alarm-on-none / patterns below 0.2
# recall:
#     0.50  0.491  58.2%   7
#     0.65  0.404  21.8%  10
#     0.75  0.354  10.1%  12
# Note the false-alarm figure is "any of 20 classifiers fires", so it is roughly
# 1% per pattern, and it is survivable because the UI leads with the ranked
# probability list rather than a binary verdict: AUC averages 0.89, so the
# ordering is trustworthy even where a clean cut isn't. The threshold only
# decides whether a pattern earns a "confident" badge.
TARGET_PRECISION = 0.65


SEED_JS = ROOT / "js" / "seed.js"


def assert_taxonomy_matches_app():
    """The Python taxonomy and the app's PATTERNS list must not drift.

    If they do, the model emits weights under ids the UI can't resolve and
    patterns silently vanish from the product. Cheap to check, expensive to
    debug later."""
    if not SEED_JS.exists():
        print("warning: js/seed.js not found; skipping taxonomy check", file=sys.stderr)
        return
    src = SEED_JS.read_text()
    block = src[src.index("const PATTERNS = ["):]
    block = block[:block.index("].map(")]
    in_app = set(re.findall(r'\[\s*"([^"]+)"', block))
    in_py = set(taxonomy.PATTERN_IDS)
    if in_app != in_py:
        raise SystemExit(
            "taxonomy drift between scripts/taxonomy.py and js/seed.js\n"
            f"  only in seed.js:    {sorted(in_app - in_py)}\n"
            f"  only in taxonomy.py:{sorted(in_py - in_app)}"
        )
    print(f"taxonomy check: {len(in_py)} patterns match js/seed.js")


def load_corpus():
    rows = []
    with CORPUS.open() as f:
        for line in f:
            rec = json.loads(line)
            if rec.get("_meta"):
                meta = rec
                continue
            rows.append(rec)
    return meta, rows


def build_matrix(rows):
    """Hand-rolled TF-IDF so the exact transform can be mirrored in JS.

    tf = 1 + log(count), x = tf * idf, then L2-normalized. Written out rather
    than delegated to TfidfVectorizer specifically so js/featurize.js can
    reproduce it line for line."""
    per_doc = [feature_counts(r["text"]) for r in rows]

    df = Counter()
    for counts in per_doc:
        df.update(counts.keys())
    vocab = {f: i for i, f in enumerate(sorted(f for f, n in df.items() if n >= MIN_DOC_FREQ))}

    n_docs = len(per_doc)
    idf = np.zeros(len(vocab))
    for f, i in vocab.items():
        idf[i] = math.log((1 + n_docs) / (1 + df[f])) + 1.0

    indptr, indices, data = [0], [], []
    for counts in per_doc:
        row = {}
        for f, c in counts.items():
            i = vocab.get(f)
            if i is not None:
                row[i] = (1.0 + math.log(c)) * idf[i]
        norm = math.sqrt(sum(v * v for v in row.values())) or 1.0
        for i, v in sorted(row.items()):
            indices.append(i)
            data.append(v / norm)
        indptr.append(len(indices))

    X = csr_matrix((data, indices, indptr), shape=(n_docs, len(vocab)))
    return X, vocab, idf


def split_labels(rows, pattern):
    """Three-way: 1 positive, 0 negative, -1 excluded (evidence too weak to call)."""
    y = np.zeros(len(rows), dtype=int)
    for i, r in enumerate(rows):
        w = r["labels"].get(pattern, 0.0)
        if w >= taxonomy.POSITIVE_THRESHOLD:
            y[i] = 1
        elif w > 0:
            y[i] = -1
    return y


def pick_threshold(y_true, probs):
    """Highest-recall threshold that still reaches TARGET_PRECISION.

    Falls back to the most precise threshold available when the target is
    unreachable, so a weak pattern is quiet rather than chatty. Returns
    (threshold, met_target)."""
    best_t, best_recall = None, -1.0
    fallback_t, fallback_p = 0.5, -1.0

    for t in np.unique(np.round(probs, 3)):
        pred = (probs >= t).astype(int)
        if pred.sum() == 0:
            continue
        p, r, _, _ = precision_recall_fscore_support(
            y_true, pred, average="binary", zero_division=0)
        if p > fallback_p or (p == fallback_p and r > 0 and t > fallback_t):
            fallback_t, fallback_p = float(t), p
        if p >= TARGET_PRECISION and r > best_recall:
            best_t, best_recall = float(t), r

    if best_t is not None:
        return best_t, True
    return fallback_t, False


def train_pattern(X, y, rows):
    """Fit one pattern, returning (model, metrics) or (None, metrics) if it
    can't be trained responsibly."""
    keep = y >= 0
    Xp, yp = X[keep], y[keep]
    n_pos = int(yp.sum())
    metrics = {"positives": n_pos, "negatives": int((yp == 0).sum()),
               "excluded": int((y == -1).sum())}

    if n_pos < MIN_POSITIVES:
        metrics["status"] = "insufficient-data"
        return None, metrics

    clf = LogisticRegression(max_iter=3000, C=REGULARIZATION_C, class_weight="balanced")
    folds = min(CV_FOLDS, n_pos)
    cv = StratifiedKFold(folds, shuffle=True, random_state=0)
    probs = cross_val_predict(clf, Xp, yp, cv=cv, method="predict_proba")[:, 1]

    metrics["auc"] = round(float(roc_auc_score(yp, probs)), 3)
    threshold, met_target = pick_threshold(yp, probs)
    p, r, f, _ = precision_recall_fscore_support(
        yp, (probs >= threshold).astype(int), average="binary", zero_division=0)
    metrics.update(threshold=round(threshold, 3), precision=round(float(p), 3),
                   recall=round(float(r), 3), f1=round(float(f), 3),
                   metTargetPrecision=bool(met_target))

    if metrics["auc"] < MIN_AUC:
        metrics["status"] = "below-quality-bar"
        return None, metrics

    metrics["status"] = "ok"
    clf.fit(Xp, yp)
    return clf, metrics


def prune(coefs, limit):
    """Keep the strongest weights. Pruning is not just size: a weight that
    barely moves the score is noise in an explanation, and the UI shows these."""
    if len(coefs) <= limit:
        idx = np.nonzero(coefs)[0]
    else:
        idx = np.argsort(np.abs(coefs))[-limit:]
    idx = idx[np.abs(coefs[idx]) > 1e-4]
    return idx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true", help="evaluate only; don't write the artifact")
    args = ap.parse_args()

    assert_taxonomy_matches_app()
    meta, rows = load_corpus()
    print(f"corpus: {len(rows)} problems from {Counter(r['source'] for r in rows)}")

    X, vocab, idf = build_matrix(rows)
    print(f"features: {len(vocab)} (min_df={MIN_DOC_FREQ}), matrix nnz={X.nnz}")

    trained, metrics_all = {}, {}
    print(f"\n{'pattern':18s} {'pos':>5s} {'AUC':>6s} {'P':>6s} {'R':>6s} {'F1':>6s}  status")
    print("-" * 66)
    for pattern in taxonomy.PATTERN_IDS:
        y = split_labels(rows, pattern)
        clf, m = train_pattern(X, y, rows)
        metrics_all[pattern] = m
        if clf is not None:
            trained[pattern] = clf
        note = m["status"]
        if m.get("status") == "ok" and not m.get("metTargetPrecision"):
            note = f"ok (below {TARGET_PRECISION:.0%} precision floor)"
        print(f"{pattern:18s} {m['positives']:5d} "
              f"{m.get('auc', float('nan')):6.3f} {m.get('precision', float('nan')):6.3f} "
              f"{m.get('recall', float('nan')):6.3f} {m.get('f1', float('nan')):6.3f}  {note}")

    ok = [p for p, m in metrics_all.items() if m["status"] == "ok"]
    aucs = [metrics_all[p]["auc"] for p in ok]
    print("-" * 66)
    print(f"shippable patterns: {len(ok)}/{len(taxonomy.PATTERN_IDS)}   mean AUC {np.mean(aucs):.3f}")

    if args.report:
        return

    # Ship only the vocabulary the surviving patterns actually use.
    used, per_pattern = set(), {}
    for pattern, clf in trained.items():
        coefs = clf.coef_[0]
        idx = prune(coefs, MAX_FEATURES_PER_PATTERN)
        per_pattern[pattern] = (idx, coefs[idx], float(clf.intercept_[0]))
        used.update(idx.tolist())

    inv = {i: f for f, i in vocab.items()}
    kept = sorted(used)
    remap = {old: new for new, old in enumerate(kept)}

    artifact = {
        "version": 1,
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "attribution": meta.get("attribution"),
        "corpusSize": len(rows),
        "featurizer": {
            "maxNgram": 3,
            "tf": "1+log(count)",
            "norm": "l2",
            "note": "js/featurize.js must mirror scripts/featurize.py exactly",
        },
        "vocab": [inv[i] for i in kept],
        "idf": [round(float(idf[i]), 4) for i in kept],
        "patterns": {
            pattern: {
                "indices": [remap[i] for i in idx.tolist()],
                "weights": [round(float(w), 4) for w in ws],
                "intercept": round(b, 4),
                "threshold": metrics_all[pattern]["threshold"],
                "auc": metrics_all[pattern]["auc"],
                "precision": metrics_all[pattern]["precision"],
                "recall": metrics_all[pattern]["recall"],
                "positives": metrics_all[pattern]["positives"],
                "metTargetPrecision": metrics_all[pattern]["metTargetPrecision"],
            }
            for pattern, (idx, ws, b) in per_pattern.items()
        },
        "unavailable": {
            p: {"status": m["status"], "positives": m["positives"],
                **({"auc": m["auc"]} if "auc" in m else {})}
            for p, m in metrics_all.items() if m["status"] != "ok"
        },
    }

    MODEL_OUT.parent.mkdir(exist_ok=True)
    MODEL_OUT.write_text(json.dumps(artifact, separators=(",", ":")))
    size_kb = MODEL_OUT.stat().st_size / 1024
    print(f"\nwrote {MODEL_OUT} ({size_kb:.0f} KB, {len(kept)} shipped features)")


if __name__ == "__main__":
    main()
