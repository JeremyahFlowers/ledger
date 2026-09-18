#!/usr/bin/env python3
"""Single source of truth for mapping external problem-bank labels onto
Ledger's 23-pattern taxonomy.

Where this fits: every stage of the ingestion pipeline (build_corpus,
train_model) imports its labels from here, so the taxonomy is defined once
rather than drifting between scripts. PATTERN_IDS must stay identical to the
PATTERNS array in js/seed.js — train_model.py asserts this at build time.

Why weighted, multi-label targets rather than one hard label: a problem is
rarely "a sliding window problem" and nothing else. LeetCode tags "Longest
Substring Without Repeating Characters" as hash-table + string +
sliding-window, and all three are true. Tag weights encode how strongly a tag
implies a pattern — "array" barely narrows anything (1,935 of 3,272 free
problems carry it), while "union-find" is nearly a pattern name. The weights
turn a flat multi-label tag set into a soft target distribution.

Why labeling functions exist at all: neither platform's vocabulary covers our
taxonomy. LeetCode has no "intervals" tag (Merge Intervals is tagged
array + sorting); Codeforces has no sliding-window, monotonic-stack, or
prefix-sum tag. For those patterns, tag supervision alone cannot learn the
concept, so a small set of deliberately high-precision regexes injects label
mass. They are meant to be precise, not exhaustive — a missed problem costs
recall, a wrong one poisons the class.
"""
import re

# Must match js/seed.js PATTERNS exactly, in any order.
PATTERN_IDS = [
    "two-pointers", "sliding-window", "arrays-hashing", "strings",
    "binary-search", "recursion-dp", "bit-manipulation", "2d-matrix",
    "knapsack", "monotonic_stack", "mst", "quick_sort", "topological_sort",
    "trie", "union-find", "linked-list", "trees", "graphs-bfs-dfs",
    "backtracking", "heap", "intervals", "prefix-sum", "greedy",
]

# Tag weights. A tag naming a pattern outright scores near 1.0; a tag that
# merely narrows the field scores low. Tags outside our taxonomy (math,
# geometry, simulation, database, game-theory...) are deliberately absent —
# forcing them into a pattern would manufacture labels we don't believe.
LEETCODE_TAG_MAP = {
    "two-pointers": [("two-pointers", 1.0)],
    "sliding-window": [("sliding-window", 1.0)],
    "binary-search": [("binary-search", 1.0)],
    "bit-manipulation": [("bit-manipulation", 1.0)],
    "bitmask": [("bit-manipulation", 0.7)],
    "matrix": [("2d-matrix", 0.9)],
    "monotonic-stack": [("monotonic_stack", 1.0)],
    "monotonic-queue": [("monotonic_stack", 0.8)],
    "stack": [("monotonic_stack", 0.3)],
    "minimum-spanning-tree": [("mst", 1.0)],
    "prims-algorithm": [("mst", 1.0)],
    "kruskals-algorithm": [("mst", 1.0)],
    "boruvkas-algorithm": [("mst", 1.0)],
    "quickselect": [("quick_sort", 0.9)],
    "quicksort": [("quick_sort", 1.0)],
    "merge-sort": [("quick_sort", 0.4)],
    "topological-sort": [("topological_sort", 1.0)],
    "directed-acyclic-graph": [("topological_sort", 0.6)],
    "trie": [("trie", 1.0)],
    "union-find": [("union-find", 1.0)],
    "linked-list": [("linked-list", 1.0)],
    "doubly-linked-list": [("linked-list", 0.9)],
    "tree": [("trees", 0.8)],
    "binary-tree": [("trees", 1.0)],
    "binary-search-tree": [("trees", 0.9)],
    "lowest-common-ancestor": [("trees", 0.8)],
    "dp-on-trees": [("trees", 0.5), ("recursion-dp", 0.5)],
    "graph": [("graphs-bfs-dfs", 0.8)],
    "depth-first-search": [("graphs-bfs-dfs", 0.7)],
    "breadth-first-search": [("graphs-bfs-dfs", 0.7)],
    "shortest-path": [("graphs-bfs-dfs", 0.6)],
    "dijkstra": [("graphs-bfs-dfs", 0.7)],
    "strongly-connected-component": [("graphs-bfs-dfs", 0.6)],
    "bipartite-graph": [("graphs-bfs-dfs", 0.6)],
    "eulerian-circuit": [("graphs-bfs-dfs", 0.5)],
    "backtracking": [("backtracking", 1.0)],
    "heap-priority-queue": [("heap", 1.0)],
    "heap": [("heap", 1.0)],
    "prefix-sum": [("prefix-sum", 1.0)],
    "greedy": [("greedy", 0.9)],
    "knapsack-problem": [("knapsack", 1.0)],
    "0-1-knapsack": [("knapsack", 1.0)],
    "complete-knapsack": [("knapsack", 1.0)],
    "multiple-knapsack": [("knapsack", 1.0)],
    "dynamic-programming": [("recursion-dp", 0.8)],
    "memoization": [("recursion-dp", 0.7)],
    "recursion": [("recursion-dp", 0.6)],
    "divide-and-conquer": [("quick_sort", 0.3), ("recursion-dp", 0.2)],
    "hash-table": [("arrays-hashing", 0.7)],
    "hash-function": [("arrays-hashing", 0.5)],
    "counting": [("arrays-hashing", 0.3)],
    "array": [("arrays-hashing", 0.25)],
    "string": [("strings", 0.4)],
    "string-matching": [("strings", 0.7)],
    "rolling-hash": [("strings", 0.6)],
    "z-algorithm": [("strings", 0.8)],
    "knuth-morris-pratt-algorithm": [("strings", 0.8)],
    "manacher": [("strings", 0.8)],
    "aho-corasick-algorithm": [("strings", 0.6), ("trie", 0.4)],
    "suffix-array": [("strings", 0.6)],
    "suffix-tree": [("strings", 0.5), ("trie", 0.3)],
    "sorting": [("intervals", 0.15), ("quick_sort", 0.15)],
    "ordered-set": [("heap", 0.2)],
}

# Codeforces uses a coarser vocabulary — no sliding-window, monotonic-stack,
# prefix-sum, trie or intervals tag exists at all. Those patterns depend
# entirely on LeetCode tags and the labeling functions below.
CODEFORCES_TAG_MAP = {
    "two pointers": [("two-pointers", 1.0)],
    "binary search": [("binary-search", 1.0)],
    "dp": [("recursion-dp", 0.8)],
    "dsu": [("union-find", 1.0)],
    "trees": [("trees", 0.9)],
    "graphs": [("graphs-bfs-dfs", 0.8)],
    "dfs and similar": [("graphs-bfs-dfs", 0.8)],
    "shortest paths": [("graphs-bfs-dfs", 0.7)],
    "graph matchings": [("graphs-bfs-dfs", 0.4)],
    "greedy": [("greedy", 0.9)],
    "strings": [("strings", 0.7)],
    "string suffix structures": [("strings", 0.6), ("trie", 0.3)],
    "hashing": [("arrays-hashing", 0.6)],
    "bitmasks": [("bit-manipulation", 0.9)],
    "divide and conquer": [("quick_sort", 0.3)],
    "brute force": [("backtracking", 0.3)],
    "meet-in-the-middle": [("backtracking", 0.3)],
    "data structures": [("heap", 0.25), ("monotonic_stack", 0.15)],
    "sortings": [("intervals", 0.15), ("quick_sort", 0.15)],
    "schedules": [("intervals", 0.5)],
    "trees dp": [("trees", 0.5), ("recursion-dp", 0.5)],
}

# Weak supervision for patterns the tag vocabularies under-serve. Precision
# over recall: each regex should be something you'd bet on in isolation.
# Applied to the normalized (lowercased, punctuation-stripped) statement.
LABELING_FUNCTIONS = {
    "intervals": [
        r"\bmerge all overlapping\b", r"\bnon overlapping intervals?\b",
        r"\bintervals?\b[^.]{0,40}\boverlap", r"\bstart_?i\b[^.]{0,20}\bend_?i\b",
        r"\bmeeting rooms?\b", r"\bearliest (start|finish) time\b",
    ],
    "prefix-sum": [
        r"\bprefix sums?\b", r"\brange sum\b", r"\bcumulative sums?\b",
        r"\bsum of (all )?elements between\b", r"\bsubarray sums? equals?\b",
    ],
    "sliding-window": [
        r"\bcontiguous subarray\b", r"\bwindow of size\b",
        r"\bsubstring\b[^.]{0,40}\bwithout repeating\b",
        r"\blongest substring\b", r"\bk consecutive\b",
    ],
    "monotonic_stack": [
        r"\bnext greater\b", r"\bnext smaller\b", r"\bnearest (greater|smaller)\b",
        r"\blargest rectangle\b", r"\bdaily temperatures\b",
        r"\bspan\b[^.]{0,30}\bstock\b",
    ],
    "knapsack": [
        r"\bknapsack\b", r"\bsubset[^.]{0,20}sums? to\b",
        r"\bpartition[^.]{0,30}equal sum\b",
        r"\bcapacity\b[^.]{0,60}\bweights?\b[^.]{0,60}\bvalues?\b",
    ],
    "heap": [
        r"\bk(th)? (largest|smallest)\b", r"\btop k\b", r"\bk closest\b",
        r"\bpriority queue\b", r"\bmedian\b[^.]{0,30}\bstream\b",
        r"\bmerge k\b",
    ],
    "trie": [
        r"\bprefix tree\b", r"\btrie\b", r"\bstarts with\b",
        r"\bautocomplete\b", r"\bword dictionary\b",
    ],
    "union-find": [
        r"\bconnected components?\b", r"\bnumber of provinces\b",
        r"\bredundant connection\b", r"\bsame (group|set)\b[^.]{0,30}\bmerge\b",
    ],
    "topological_sort": [
        r"\bprerequisit", r"\bcourse schedule\b",
        r"\bdependenc(y|ies)\b[^.]{0,40}\border\b", r"\bbuild order\b",
    ],
    "mst": [
        r"\bminimum spanning tree\b", r"\bconnect all points\b",
        r"\bminimum cost to connect\b",
    ],
    "backtracking": [
        r"\ball possible (combinations|permutations|subsets)\b",
        r"\bgenerate all\b", r"\bn queens\b", r"\bsudoku\b",
        r"\breturn all (unique )?(combinations|permutations|subsets)\b",
    ],
    "quick_sort": [
        r"\bdutch national flag\b", r"\bsort colors\b",
        r"\bpartition\b[^.]{0,30}\bpivot\b",
        r"\bwithout (fully )?sorting\b",
    ],
    "2d-matrix": [
        r"\bm x n\b", r"\bspiral order\b", r"\brotate the (image|matrix)\b",
        r"\bin place\b[^.]{0,30}\bmatrix\b",
    ],
    "linked-list": [
        r"\blinked list\b", r"\blistnode\b", r"\bhead of the list\b",
        r"\bcycle\b[^.]{0,30}\blist\b",
    ],
    "two-pointers": [
        r"\btwo pointers?\b", r"\bpalindrome\b",
        r"\bsorted array\b[^.]{0,40}\bpairs?\b",
    ],
    "graphs-bfs-dfs": [
        r"\bnumber of islands\b", r"\badjacency (list|matrix)\b",
        r"\bshortest path\b[^.]{0,40}\bunweighted\b",
    ],
    "bit-manipulation": [
        r"\bxor\b", r"\bbitwise\b", r"\bset bits?\b", r"\bbinary representation\b",
    ],
}

_COMPILED_LFS = {p: [re.compile(r) for r in pats] for p, pats in LABELING_FUNCTIONS.items()}

# A labeling-function hit is real evidence but noisier than a curated tag, so
# it contributes less mass than a 1.0-weight tag would.
LF_WEIGHT = 0.6

# Minimum label weight to assert a pattern applies. Below this the evidence is
# a hint, not a claim: "data structures" implying heap at 0.25, or "sorting"
# implying intervals at 0.15. Training treats sub-threshold labels as neither
# positive nor negative and drops those rows from that pattern's fit, because
# calling them negative would be just as wrong as calling them positive.
POSITIVE_THRESHOLD = 0.5


def labels_from_tags(tags, source):
    """Map a problem's platform tags to {pattern_id: weight}, keeping the
    strongest weight when several tags point at the same pattern."""
    table = LEETCODE_TAG_MAP if source == "leetcode" else CODEFORCES_TAG_MAP
    out = {}
    for tag in tags:
        for pattern_id, weight in table.get(tag.strip().lower(), []):
            out[pattern_id] = max(out.get(pattern_id, 0.0), weight)
    return out


def labels_from_text(normalized_text):
    """Apply the labeling functions to a normalized statement."""
    out = {}
    for pattern_id, regexes in _COMPILED_LFS.items():
        if any(r.search(normalized_text) for r in regexes):
            out[pattern_id] = LF_WEIGHT
    return out


def combine_labels(tag_labels, lf_labels):
    """Union the two noisy label sources, taking the strongest evidence per
    pattern. Kept separate from the callers so the merge rule is defined once."""
    out = dict(tag_labels)
    for pattern_id, weight in lf_labels.items():
        out[pattern_id] = max(out.get(pattern_id, 0.0), weight)
    return out
