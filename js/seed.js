// The starting state, built fresh on first connect from what's actually in
// the leetcode repo today. Every problem starts due immediately (box 0) so
// day one already has a real review queue instead of an empty app.
import { todayISO, newDayTimer } from "./logic.js";
import { APP_VERSION } from "./version.js";

const PATTERNS = [
  ["two-pointers", "Two Pointers", "Converging or fixed-offset pointers over a sorted or linear structure."],
  ["sliding-window", "Sliding Window", "Variable- or fixed-size window scanned across a string or array."],
  ["arrays-hashing", "Arrays & Hashing", "Hash maps and sets for fast lookup over arrays and strings."],
  ["strings", "Strings", "String manipulation that isn't primarily two-pointer or window-based."],
  ["binary-search", "Binary Search", "Search over a monotonic function or sorted structure."],
  ["recursion-dp", "Recursion / DP", "Recursive search and dynamic programming."],
  ["bit-manipulation", "Bit Manipulation", "Bitwise tricks: masks, shifts, and counting."],
  ["2d-matrix", "2D Matrix", "Traversal and in-place transformation of 2D grids."],
  ["knapsack", "Knapsack", "0/1 and unbounded knapsack — subset/partition DP."],
  ["monotonic_stack", "Monotonic Stack", "Stack or deque kept in sorted order to answer next-greater / sliding-extreme queries."],
  ["mst", "Minimum Spanning Tree", "Prim's and Kruskal's algorithms."],
  ["quick_sort", "Partitioning / Quicksort", "Partition-based sorting and selection."],
  ["topological_sort", "Topological Sort", "Ordering a DAG via Kahn's algorithm or DFS."],
  ["trie", "Trie", "Prefix tree for fast string-prefix operations."],
  ["union-find", "Union-Find", "Disjoint-set union for connectivity queries."],
  ["linked-list", "Linked List", "Pointer rewiring — reversal, fast/slow traversal, merging."],
  ["trees", "Trees", "Binary tree traversal — DFS pre/in/post-order, BFS level-order, BST properties."],
  ["graphs-bfs-dfs", "Graph Traversal", "General BFS/DFS over graphs — islands, connected components, shortest unweighted path."],
  ["backtracking", "Backtracking", "Depth-first search over a decision tree, undoing choices that don't pan out."],
  ["heap", "Heap / Priority Queue", "Top-K, k-way merge, running median — cheap access to the current min or max."],
  ["intervals", "Intervals", "Sort by start, then sweep — merge, insert, and scheduling problems."],
  ["prefix-sum", "Prefix Sum", "Precompute running totals so range queries become a subtraction."],
  ["greedy", "Greedy", "Locally optimal choices, never revisited — valid only when that's provably safe."],
].map(([id, name, description]) => ({ id, name, description }));

export { PATTERNS };

const PROBLEMS = [
  ["3sum", "3Sum", 15, "Medium", "two-pointers", "Sort, then fix one index and two-pointer the rest; skip duplicates.", "two-pointers/3_sum.cpp"],
  ["container-with-most-water", "Container With Most Water", 11, "Medium", "two-pointers", "Pointers from both ends, move the shorter line inward.", "two-pointers/container_with_most_water.cpp"],
  ["longest-substring-without-repeating-characters", "Longest Substring Without Repeating Characters", 3, "Medium", "sliding-window", "Variable window with a 26-slot frequency array.", "sliding-window/longest_substring_without_repeating_characters.cpp"],
  ["permutation-in-string", "Permutation in String", 567, "Medium", "sliding-window", "Fixed-size window, compare frequency vectors.", "sliding-window/permutation_in_string.cpp"],
  ["find-all-anagrams-in-a-string", "Find All Anagrams in a String", 438, "Medium", "sliding-window", "Fixed-size window, compare frequency vectors, collect all matches.", "sliding-window/find_all_anagrams_in_string.cpp"],
  ["minimum-window-substring", "Minimum Window Substring", 76, "Hard", "sliding-window", "Variable window with formed/required distinct-character tracking.", "sliding-window/minimum_window_substring.cpp"],
  ["group-anagrams", "Group Anagrams", 49, "Medium", "arrays-hashing", "Hash map keyed by the sorted form of each string.", "arrays-hashing/group_anagrams.cpp"],
  ["longest-consecutive-sequence", "Longest Consecutive Sequence", 128, "Medium", "arrays-hashing", "Hash set; only start counting a streak from its lower bound.", "arrays-hashing/longest_consecutive_sequence.cpp"],
  ["product-of-array-except-self", "Product of Array Except Self", 238, "Medium", "arrays-hashing", "Prefix products forward, suffix product folded in on a second pass.", "arrays-hashing/product_array_except_itself.cpp"],
  ["reverse-words-in-a-string", "Reverse Words in a String", 151, "Medium", "strings", "Tokenize with stringstream, prepend each word.", "strings/reverse_words_in_string.cpp"],
  ["missing-element-in-sorted-array", "Missing Element in Sorted Array", 1060, "Medium", "binary-search", "Binary search on a count-of-missing-numbers-so-far function.", "binary-search/missing_element_in_sorted_array.cpp", "LeetCode Premium"],
  ["minimum-cost-to-merge-sorted-lists", "Minimum Cost to Merge Sorted Lists", null, "Unrated", "recursion-dp", "Brute-force recursive best-pair search — exponential, unmemoized. Known gap: DP intent was never implemented.", "recursion-dp/minimum_cost_to_merge_sorted_list.cpp"],
  ["rotate-image", "Rotate Image", 48, "Medium", "2d-matrix", "Transpose the matrix, then reverse each row in place.", "2d-matrix/rotate_matrix.cpp"],
  ["spiral-matrix", "Spiral Matrix", 54, "Medium", "2d-matrix", "Track four shrinking boundaries and walk them in order: right, down, left, up.", "2d-matrix/spiral_matrix.cpp"],
  ["partition-equal-subset-sum", "Partition Equal Subset Sum", 416, "Medium", "knapsack", "Subset-sum DP over half the total.", "knapsack/partition_equal_subset_sum.cpp"],
  ["knapsack-reference", "0/1 Knapsack (reference)", null, "Unrated", "knapsack", "Reference implementation — bottom-up, top-down memo, and brute-force variants side by side.", "knapsack/traditional_knapsack.cpp"],
  ["largest-rectangle-in-histogram", "Largest Rectangle in Histogram", 84, "Hard", "monotonic_stack", "Monotonic increasing stack of bar indices; pop and compute width when a shorter bar arrives.", "monotonic_stack/largest_rectangle_in_histogram.cpp"],
  ["sliding-window-maximum", "Sliding Window Maximum", 239, "Hard", "monotonic_stack", "Monotonic decreasing deque of indices; front is always the current window max.", "monotonic_stack/largest_sliding_window.cpp"],
  ["min-cost-to-connect-all-points", "Min Cost to Connect All Points", 1584, "Medium", "mst", "Prim's algorithm from an arbitrary start, growing the MST with a min-heap of edge costs.", "mst/min_cost_to_connect_all_points.cpp"],
  ["sort-colors", "Sort Colors", 75, "Medium", "quick_sort", "Dutch national flag — three pointers (low/mid/high) partition in one pass.", "quick_sort/quick_sort.cpp"],
  ["course-schedule-ii", "Course Schedule II", 210, "Medium", "topological_sort", "Kahn's algorithm — topological sort via in-degree queue; empty queue before all nodes visited means a cycle.", "topological_sort/course_schedule_II.cpp"],
  ["implement-trie", "Implement Trie (Prefix Tree)", 208, "Medium", "trie", "Children map per node plus an end-of-word flag.", "trie/implement_trie.cpp"],
  ["number-of-provinces", "Number of Provinces", 547, "Medium", "union-find", "Union-find over the adjacency matrix; count remaining distinct roots.", "union-find/number_of_provinces.cpp"],
].map(([id, name, number, difficulty, patternId, approach, filePath, notes]) => ({
  id, name, number, difficulty, patternId, approach, filePath, notes: notes || "",
  box: 0,
  nextReviewDate: todayISO(),
  attempts: [],
}));

export function buildSeedState() {
  return {
    meta: { schemaVersion: 2, createdAt: new Date().toISOString() },
    settings: {
      dailyBudgetMin: 75,
      boxIntervalsDays: [0, 1, 3, 7, 16, 35],
      estimateMinByDifficulty: { Easy: 20, Medium: 30, Hard: 45, Unrated: 30 },
      systemDesignUnlockThreshold: { minMocks: 10, minSolvedCleanRate: 0.7 },
    },
    patterns: PATTERNS,
    problems: PROBLEMS,
    mocks: [],
    journal: [],
    systemDesign: { manualUnlock: false, sessions: [] },
    streak: { current: 0, longest: 0, lastActiveDate: null },
    resources: {}, // { [patternId]: [{ id, title, url, addedAt }] } — user-curated video/article links
    whiteboards: [], // [{ id, date, problemId, path, caption }] — index of saved drawings (images live as separate repo files)
    quiz: { totalAsked: 0, totalCorrect: 0, recent: [] }, // recent: last 20 {correct: bool} for a trend
    dayTimer: newDayTimer(),
  };
}

/** Backfills fields added after a state.json was first created, without
 * touching anything that already exists. Safe to call on every load. */
export function migrateState(state) {
  if (!state.resources) state.resources = {};
  if (!state.whiteboards) state.whiteboards = [];
  if (!state.quiz) state.quiz = { totalAsked: 0, totalCorrect: 0, recent: [] };
  // Deliberately not backfilled with today's date: newDayTimer() stamps the
  // day it was made, and logic.js treats a timer from another date as an empty
  // day, so an absent one and a stale one behave identically.
  if (!state.dayTimer) state.dayTimer = newDayTimer();
  if (!state.meta) state.meta = { schemaVersion: 2, createdAt: new Date().toISOString() };
  // Which release last opened this file. Separate from schemaVersion, which
  // says what shape the data is in: this says which build produced it, so when
  // something looks wrong in a synced state there's a way to tell what wrote
  // it without guessing from the commit history.
  state.meta.appVersion = APP_VERSION;
  // Backfill any patterns added after this state.json was first created —
  // merge by id so nothing already there (and no progress against it) is
  // touched, just append what's missing.
  const known = new Set((state.patterns || []).map((p) => p.id));
  for (const p of PATTERNS) {
    if (!known.has(p.id)) state.patterns.push({ ...p });
  }
  // Problems saved before the bank existed were all deliberately chosen, so
  // they stay in the review rotation. Only problems added from the bank after
  // this point start as backlog. See STATUS_ACTIVE/STATUS_BACKLOG in logic.js.
  for (const p of state.problems || []) {
    if (!p.status) p.status = "active";
  }
  state.meta.schemaVersion = Math.max(state.meta.schemaVersion || 1, 4);
  return state;
}
