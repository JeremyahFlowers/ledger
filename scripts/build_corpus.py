#!/usr/bin/env python3
"""Builds the two datasets the pattern model needs.

    build_corpus.py corpus   -> data/corpus.jsonl   (training text, both domains)
    build_corpus.py catalog  -> data/catalog.json   (problem catalog, metadata only)
    build_corpus.py all      -> both

Where this fits: first stage of the ingestion pipeline. train_model.py consumes
corpus.jsonl; the app serves catalog.json directly as its problem database.

Everything is read from published Hugging Face datasets via parquet column
projection. Nothing here scrapes LeetCode: its robots.txt disallows /graphql,
and its statements are copyrighted, so we neither crawl them nor store them.

Two training domains, because one is not enough:

* CodeContests (CC BY 4.0) is competitive-programming text. Measured against
  our taxonomy it can only support 11 of 23 patterns — Codeforces simply
  doesn't pose linked-list, trie, or monotonic-stack problems.

* A LeetCode-domain set supplies the interview patterns the first corpus
  misses (sliding window, 2D matrix, prefix sum, backtracking, monotonic
  stack, trie, linked list) and removes the domain gap between what the model
  trains on and what a user actually pastes in.

The catalog is metadata only — title, number, difficulty, tags, URL. Its
pattern weights come from each problem's own LeetCode tags, so catalog entries
are labeled rather than predicted.

LICENSING: see SOURCES below, which is embedded verbatim into the emitted
artifacts and surfaced in the app. Training reads statement text; the published
model contains only n-gram weights, and no problem text is ever stored in or
redistributed by this repository.
"""
import argparse
import ast
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import taxonomy  # noqa: E402
from featurize import to_plain  # noqa: E402

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
HF_PARQUET = "https://huggingface.co/api/datasets/{ds}/parquet/default/{split}"
PARQUET_COLUMNS = ["name", "description", "cf_tags", "difficulty", "source"]

# Every dataset we read, why, and under what terms. Surfaced in the model
# artifact and in the app's Settings page — provenance should be visible to
# whoever is looking at a prediction, not buried in a script.
SOURCES = {
    "codecontests": {
        "dataset": "deepmind/code_contests",
        "license": "CC BY 4.0",
        "url": "https://github.com/google-deepmind/code_contests",
        "role": "training text (competitive-programming domain)",
    },
    "leetcode-text": {
        "dataset": "newfacade/LeetCodeDataset",
        "license": "Apache-2.0 (compilation); underlying statements are LeetCode's",
        "url": "https://huggingface.co/datasets/newfacade/LeetCodeDataset",
        "role": "training text (interview domain)",
        "note": "Used for training only. No statement text is stored or redistributed "
                "by Ledger — the published artifact contains n-gram weights only.",
    },
    "catalog": {
        "dataset": "kaysss/leetcode-problem-set",
        "license": "MIT (compilation); metadata only, no problem text",
        "url": "https://huggingface.co/datasets/kaysss/leetcode-problem-set",
        "role": "problem catalog",
    },
}


def _read_parquet(dataset, split="train", columns=None):
    """Stream a HF dataset reading only the columns asked for.

    Column projection matters: CodeContests is 7.6 GB on disk, almost all of it
    bundled test cases and solutions we never look at. Projecting to five
    columns pulls a small fraction of that."""
    import pyarrow.parquet as pq
    import fsspec

    shards = json.loads(urllib.request.urlopen(
        HF_PARQUET.format(ds=dataset, split=split), timeout=60).read())
    fs = fsspec.filesystem("http")
    for i, url in enumerate(shards, 1):
        table = pq.ParquetFile(fs.open(url)).read(columns=columns)
        yield i, len(shards), table.to_pylist()

MIN_STATEMENT_CHARS = 200  # below this a "statement" is a stub, not a problem


def _tag_list(value):
    """Normalize a tag field to a list of slugs.

    Sources disagree on how they store this: one parquet column is a real list,
    another holds the *string* "['Array', 'Hash Table']". Iterating the latter
    yields characters, which silently produced an empty catalog until this was
    centralized here."""
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("["):
            try:
                value = ast.literal_eval(text)
            except (ValueError, SyntaxError):
                value = [t for t in re.split(r"[,;|]", text.strip("[]")) if t.strip()]
        else:
            value = [t for t in re.split(r"[,;|]", text) if t.strip()]
    return [_slug(t) for t in value if str(t).strip()]


def _slug(tag):
    """LeetCode's own slug form. Punctuation must go: the tag ships as
    "Heap (Priority Queue)", and leaving the parentheses in produced
    "heap-(priority-queue)", which matched nothing and silently dropped 152
    heap problems from training."""
    s = str(tag).strip().strip("'\"").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def _label(text_for_rules, tags, source):
    """Tag labels unioned with labeling-function labels. One place, so
    CodeContests and LeetCode rows are labeled by identical rules."""
    tag_labels = taxonomy.labels_from_tags(tags, source)
    lf_labels = taxonomy.labels_from_text(text_for_rules.lower())
    return tag_labels, lf_labels, taxonomy.combine_labels(tag_labels, lf_labels)


def build_codecontests(limit=None):
    rows, skipped = [], 0
    for i, total, records in _read_parquet(SOURCES["codecontests"]["dataset"],
                                           columns=PARQUET_COLUMNS):
        for rec in records:
            tags = [t for t in (rec.get("cf_tags") or []) if t and not t.startswith("*")]
            description = rec.get("description") or ""
            if not tags or len(description) < MIN_STATEMENT_CHARS:
                skipped += 1
                continue
            text, _ = to_plain(description)
            tag_labels, lf_labels, labels = _label(text, tags, "codeforces")
            # A tagged problem that maps to no pattern is kept deliberately, with
            # empty labels. These are the math / geometry / constructive problems
            # that genuinely aren't any of our 23 patterns, and they serve as
            # negatives for every classifier. Without them the model never sees a
            # problem that isn't one of ours, and answers "73% sliding window" to
            # a number-theory question instead of "none of these apply".
            rows.append({
                "id": f"cc:{rec['name']}",
                "source": "codecontests",
                "name": rec["name"],
                "text": description,
                "raw_tags": tags,
                "labels": labels,
                "from_tags": sorted(tag_labels),
                "from_rules": sorted(lf_labels),
            })
        print(f"  shard {i}/{total}: {len(rows)} kept, {skipped} skipped", file=sys.stderr)
        if limit and len(rows) >= limit:
            rows = rows[:limit]
            break
    return rows


LEETCODE_TEXT_COLUMNS = ["question_id", "problem_description", "tags", "difficulty"]


def build_leetcode_text(limit=None):
    """Interview-domain training text. LeetCode's own topic tags are the labels,
    which is why this corpus covers the patterns Codeforces never tags —
    sliding window, monotonic stack, trie, linked list, prefix sum."""
    rows, skipped, seen = [], 0, set()
    for i, total, records in _read_parquet(SOURCES["leetcode-text"]["dataset"],
                                           columns=LEETCODE_TEXT_COLUMNS):
        for rec in records:
            qid = rec.get("question_id")
            description = rec.get("problem_description") or ""
            if qid in seen or len(description) < MIN_STATEMENT_CHARS:
                skipped += 1
                continue
            seen.add(qid)
            tags = _tag_list(rec.get("tags"))
            if not tags:
                skipped += 1
                continue
            text, _ = to_plain(description)
            tag_labels, lf_labels, labels = _label(text, tags, "leetcode")
            rows.append({
                "id": f"lc:{qid}",
                "source": "leetcode",
                "name": f"LeetCode {qid}",
                "text": description,
                "raw_tags": tags,
                "labels": labels,
                "from_tags": sorted(tag_labels),
                "from_rules": sorted(lf_labels),
            })
        print(f"  shard {i}/{total}: {len(rows)} kept, {skipped} skipped", file=sys.stderr)
        if limit and len(rows) >= limit:
            rows = rows[:limit]
            break
    return rows


def write_corpus(all_rows, sources_used):
    DATA_DIR.mkdir(exist_ok=True)
    out = DATA_DIR / "corpus.jsonl"
    with out.open("w") as f:
        f.write(json.dumps({
            "_meta": True,
            "builtAt": datetime.now(timezone.utc).isoformat(),
            "attribution": [SOURCES[s] for s in sources_used],
            "count": len(all_rows),
        }) + "\n")
        for r in all_rows:
            f.write(json.dumps(r) + "\n")
    by_source = {}
    for r in all_rows:
        by_source[r["source"]] = by_source.get(r["source"], 0) + 1
    print(f"wrote {out}: {len(all_rows)} problems {by_source}")


CATALOG_COLUMNS = ["frontendQuestionId", "title", "titleSlug", "difficulty", "paidOnly", "topicTags"]


def _labels_from_corpus():
    """Pattern labels derived from statement text, keyed by problem number.

    Tags alone leave holes in the catalog: LeetCode has no "intervals" tag, so
    every intervals problem scored 0.15 via "sorting" and none reached the
    confidence threshold — the pattern the model predicts best (AUC 0.97) had
    zero problems to practice. The training corpus already contains those
    statements and we already run the labeling functions over them, so the
    labels are merged in here. Only the labels cross over; no statement text is
    written to the catalog."""
    path = DATA_DIR / "corpus.jsonl"
    if not path.exists():
        print("  note: no corpus.jsonl yet — catalog will use tags only", file=sys.stderr)
        return {}
    out = {}
    with path.open() as f:
        for line in f:
            rec = json.loads(line)
            if rec.get("_meta") or rec.get("source") != "leetcode":
                continue
            out[rec["id"].split(":", 1)[1]] = rec["labels"]
    return out


def build_catalog():
    """The searchable problem database — facts only: title, number, difficulty,
    tags, URL. No statement text, so nothing here is LeetCode's prose.

    Pattern weights come from each problem's own LeetCode tags, merged with
    labels derived from its statement during corpus building. Both are labels
    rather than predictions: exact where LeetCode tagged the problem, and
    rule-derived where it didn't."""
    text_labels = _labels_from_corpus()
    catalog, skipped, enriched = [], 0, 0
    for i, total, records in _read_parquet(SOURCES["catalog"]["dataset"],
                                           columns=CATALOG_COLUMNS):
        for q in records:
            if q.get("paidOnly"):
                skipped += 1  # statement isn't publicly viewable, so it can't be practiced
                continue
            tags = _tag_list(q.get("topicTags"))
            labels = taxonomy.labels_from_tags(tags, "leetcode")
            qid = str(q.get("frontendQuestionId") or "")
            if qid in text_labels:
                before = dict(labels)
                labels = taxonomy.combine_labels(labels, text_labels[qid])
                if labels != before:
                    enriched += 1
            if not labels:
                skipped += 1
                continue
            catalog.append({
                "slug": q["titleSlug"],
                "title": q["title"],
                "number": int(qid) if qid.isdigit() else None,
                "difficulty": q.get("difficulty"),
                "url": f"https://leetcode.com/problems/{q['titleSlug']}/",
                "tags": tags,
                "patterns": {k: round(v, 3) for k, v in sorted(labels.items(), key=lambda kv: -kv[1])},
            })
        print(f"  shard {i}/{total}: {len(catalog)} kept, {skipped} skipped, "
              f"{enriched} enriched from statement text", file=sys.stderr)

    DATA_DIR.mkdir(exist_ok=True)
    out = DATA_DIR / "catalog.json"
    out.write_text(json.dumps({
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "attribution": SOURCES["catalog"],
        "count": len(catalog),
        "problems": catalog,
    }, indent=1))
    print(f"wrote {out} ({len(catalog)} problems, {skipped} skipped)")
    return catalog


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target", choices=["corpus", "catalog", "all"],
                    help="corpus = training text from both sources; catalog = the problem database")
    ap.add_argument("--limit", type=int, default=None, help="stop after N problems per source (quick local runs)")
    args = ap.parse_args()

    if not os.environ.get("SSL_CERT_FILE"):
        try:  # macOS framework Pythons often ship without a usable CA bundle
            import certifi
            os.environ["SSL_CERT_FILE"] = certifi.where()
        except ImportError:
            pass

    if args.target in ("corpus", "all"):
        print("building training corpus...")
        rows = build_codecontests(limit=args.limit) + build_leetcode_text(limit=args.limit)
        write_corpus(rows, ["codecontests", "leetcode-text"])
    if args.target in ("catalog", "all"):
        print("building problem catalog...")
        build_catalog()


if __name__ == "__main__":
    main()
