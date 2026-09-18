// Curriculum content for the Topics tab: one deep-dive per pattern. Written
// as genuine technique explanations (not fetched or fabricated from
// anywhere) — the "practice ladder" for each is built at render time from
// your own logged problems in views.js, not hardcoded here, so it stays
// accurate as you log more.
export const TOPICS = {
  "two-pointers": {
    concept:
      "Two indices move through a linear structure — usually sorted — converging toward each other or advancing at different rates, replacing what would otherwise be a nested loop.",
    recognize: ["sorted array", "pair or triplet sums to a target", "palindrome check", "merge two sorted structures"],
    invariant: "Everything the pointers have already passed satisfies a property you can rely on without re-checking it.",
    pitfalls: [
      "Forgetting to skip duplicates when the problem wants unique results (classic 3Sum bug).",
      "Advancing both pointers when the comparison says only one should move.",
      "Off-by-one on the stopping condition — l < r vs l <= r changes whether the middle element is revisited.",
    ],
  },
  "sliding-window": {
    concept:
      "Maintain a window [left, right] over an array or string. Expand right to explore, contract left to restore a violated constraint, and track a running aggregate incrementally instead of recomputing it per window.",
    recognize: ["substring / subarray", "contiguous", "at most K / exactly K distinct", "longest or shortest satisfying a condition"],
    invariant: "The window always satisfies — or is actively being brought back to satisfy — the constraint, and the aggregate exactly reflects the window's current contents.",
    pitfalls: [
      "Using `if` to shrink when the window is variable-size and needs a `while`.",
      "Updating the aggregate on expand but forgetting to undo it on contract.",
      "Off-by-one on window length: it's right - left + 1, not right - left.",
    ],
  },
  "arrays-hashing": {
    concept:
      "Trade space for near-O(1) lookup: a hash set to remember what's been seen, or a hash map keyed by a derived signature (sorted string, frequency vector) to group related items.",
    recognize: ["have I seen this before", "count occurrences", "group by some derived key", "does the complement exist"],
    invariant: "The map always reflects exactly what's been processed so far — nothing more, nothing less.",
    pitfalls: [
      "Mutating the array while also using it to build a hash key.",
      "Using a mutable object as a map key without first converting it to a canonical string.",
      "Rebuilding the whole map every iteration instead of updating it incrementally.",
    ],
  },
  strings: {
    concept:
      "Manipulation that's really about the shape of text — tokenizing, building output character by character, reversing in place — rather than a search pattern from the categories above.",
    recognize: ["parsing with delimiters", "in-place transformation", "character classification", "the hard part is edge cases, not the algorithm"],
    invariant: "You always know exactly where the current token starts and ends.",
    pitfalls: [
      "Off-by-one on substring bounds.",
      "Not handling empty strings or whitespace-only input.",
      "Naive concatenation in a loop going quadratic in languages where strings are immutable.",
    ],
  },
  "binary-search": {
    concept:
      "Halve the search space using a monotonic predicate — 'is this value good enough' — even when the input doesn't look sorted at first glance.",
    recognize: ["sorted", "minimize the maximum / maximize the minimum", "a boundary between a false region and a true region", "answer needs to be O(log n)"],
    invariant: "lo and hi always bracket a range that contains the answer, and the predicate flips exactly once inside it.",
    pitfalls: [
      "Infinite loops when mid doesn't actually shrink the range on every iteration.",
      "Mixing up lo <= hi (searching for an exact index) with lo < hi (searching for a boundary).",
      "mid = (lo + hi) / 2 overflowing — use lo + (hi - lo) / 2 in fixed-width integer languages.",
    ],
  },
  "recursion-dp": {
    concept:
      "Break a problem into overlapping subproblems and solve each exactly once — top-down with memoization, or bottom-up with an iterative table.",
    recognize: ["count the ways to...", "minimum/maximum cost to reach...", "can you partition/reach a target", "optimal substructure with overlapping subproblems"],
    invariant: "Once a memo or table entry is written, it's the final correct answer for that state — never partially correct.",
    pitfalls: [
      "Recomputing without memoizing — this repo's own minimum_cost_to_merge_sorted_lists.cpp is a live example of exactly this bug.",
      "A base case that's slightly wrong, which silently corrupts every state built on top of it.",
      "A state definition missing a dimension that actually matters (e.g. 'used item i or not').",
    ],
  },
  "bit-manipulation": {
    concept:
      "Use bitwise operators to pack and unpack information, toggle or check individual bits, and exploit properties like XOR's self-cancellation.",
    recognize: ["without extra space", "a single number among duplicates", "power of two", "count set bits"],
    invariant: "You always know exactly what each bit position in your encoding represents.",
    pitfalls: [
      "Sign-extension surprises from right-shifting a negative number.",
      "Off-by-one on bit index — confirm whether you're 0-indexing from the LSB.",
      "Operator precedence: bitwise operators bind looser than comparisons in C-family languages, so `a & b == c` isn't what it looks like.",
    ],
  },
  "2d-matrix": {
    concept:
      "Traversal or in-place transformation of a grid, usually via shrinking boundaries (top/bottom/left/right) or a direction vector with a 'turn when blocked' rule.",
    recognize: ["rotate", "spiral order", "search a row/column-sorted grid", "in-place transformation"],
    invariant: "Shrinking boundaries never cross, and a direction vector plus a turn rule fully describes the walk.",
    pitfalls: [
      "Transposing then reversing the wrong axis (rows vs columns).",
      "Off-by-one on boundary comparisons — <= vs < at the edges.",
      "Overwriting a cell before reading the value you still needed from it.",
    ],
  },
  knapsack: {
    concept:
      "Choice DP over items and a capacity/target dimension: 0/1 (include or exclude each item once) or unbounded (include any number of times).",
    recognize: ["subset sums to X", "partition into two equal halves", "minimum coins to make change", "maximum value under a weight limit"],
    invariant: "dp[i][cap] means 'best achievable using the first i items within capacity cap' — never referencing items not yet decided.",
    pitfalls: [
      "Iterating the capacity loop the wrong direction: backward for 0/1 (forward double-counts an item), forward for unbounded.",
      "Off-by-one between capacity and array index.",
      "Forgetting the dp[0][*] base case, which corrupts everything built on top of it.",
    ],
  },
  monotonic_stack: {
    concept:
      "Keep a stack (or deque) in strict sorted order by evicting anything that violates it before pushing — the eviction moment reveals 'next greater/smaller' relationships in O(n) total.",
    recognize: ["next greater or smaller element", "largest rectangle in a histogram", "sliding window maximum/minimum"],
    invariant: "The stack/deque is always strictly increasing or strictly decreasing (pick one, stay consistent) — an eviction IS the answer for the evicted element.",
    pitfalls: [
      "Storing values instead of indices when you need the index or width later.",
      "Reaching for a plain stack when the window is fixed-size — that needs a deque with eviction from both ends.",
      "Off-by-one on the width calculation after popping.",
    ],
  },
  mst: {
    concept:
      "Build a spanning tree of minimum total edge weight: Prim's grows outward from a start node with a min-heap of frontier edges; Kruskal's sorts all edges and union-finds the cheapest ones that don't form a cycle.",
    recognize: ["connect all points/nodes with minimum total cost"],
    invariant: "The growing tree never contains a cycle, and every edge added was the cheapest available at that moment.",
    pitfalls: [
      "Skipping path compression / union by rank in Kruskal's — still correct, just slow on adversarial input.",
      "Forgetting Prim's needs a visited set, or you'll re-add a node that's already in the tree.",
      "Not being able to justify Prim's vs Kruskal's out loud (dense graphs usually favor Prim's, sparse favor Kruskal's).",
    ],
  },
  quick_sort: {
    concept:
      "Partition-based sorting or selection: pick a pivot, rearrange so smaller elements land left and larger land right, then recurse on the side you actually need (quickselect) or both (full sort).",
    recognize: ["kth largest/smallest", "sort in-place", "three-way partition (Dutch national flag)"],
    invariant: "Everything left of the partition boundary is provably, permanently on the correct side — you never revisit it.",
    pitfalls: [
      "A partition scheme that doesn't shrink the range on all-equal input, causing an infinite loop.",
      "Worst-case O(n²) on already-sorted input with a naive first-or-last-element pivot.",
      "Off-by-one swapping the pivot into its final resting position.",
    ],
  },
  topological_sort: {
    concept:
      "Order the nodes of a DAG so every edge points from earlier to later — Kahn's algorithm repeatedly removes in-degree-0 nodes, or DFS postorder reversed.",
    recognize: ["course prerequisites", "build order", "any valid ordering respecting dependencies"],
    invariant: "A node is only emitted once every one of its prerequisites has already been emitted.",
    pitfalls: [
      "Not detecting a cycle — in Kahn's, emitting fewer nodes than exist in the graph means a cycle, and that's often the actual question being asked.",
      "The DFS version needs a three-color (unvisited/in-progress/done) scheme to catch back-edges, not just a visited boolean.",
    ],
  },
  trie: {
    concept:
      "A tree where each root-to-node path spells out a prefix, giving prefix search, autocomplete, and exact-word lookup in O(word length) regardless of dictionary size.",
    recognize: ["prefix", "autocomplete", "many queries against one fixed dictionary of words"],
    invariant: "Every node's children fully represent every string sharing its path as a prefix; an explicit end-of-word flag marks complete words.",
    pitfalls: [
      "Forgetting the end-of-word flag and confusing 'prefix exists' with 'word exists' — one word can be a prefix of another.",
      "Hardcoding a 26-slot child array when the alphabet isn't strictly lowercase a-z.",
    ],
  },
  "union-find": {
    concept:
      "A disjoint-set structure answering 'are these connected' and 'merge these two groups' in near-O(1) amortized, using path compression and union by rank/size.",
    recognize: ["connected components", "detect a cycle in an undirected graph", "accounts merge / provinces / islands via union operations"],
    invariant: "find(x) always returns the same representative for everything in x's component; path compression changes lookup speed, never correctness.",
    pitfalls: [
      "Skipping path compression or union by rank — still correct, just degrades toward O(n) per call on adversarial input.",
      "Off-by-one when nodes are 1-indexed but the backing array is 0-indexed.",
    ],
  },
};
