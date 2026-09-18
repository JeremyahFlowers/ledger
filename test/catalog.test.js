// Tests for js/catalog.js — the problem database and the record shape that
// gets written into the user's synced state.
//
// The shape matters more than it looks: every saved problem is serialized into
// a single state.json that syncs through an API with a 1 MB ceiling, so a few
// stray bytes per record is a feature that stops working at scale.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  slugify, savedSlugs, problemUrl, problemFromCatalog, loadCatalog,
  problemsForPattern, countsByPattern,
  PATTERN_CONFIDENCE, MAX_BANK_SIZE,
} from "../js/catalog.js";
import { STATUS_BACKLOG, STATUS_ACTIVE } from "../js/logic.js";

function makeEntry(over = {}) {
  return {
    slug: "merge-intervals",
    title: "Merge Intervals",
    number: 56,
    difficulty: "Medium",
    url: "https://leetcode.com/problems/merge-intervals/",
    tags: ["array", "sorting"],
    patterns: { intervals: 0.6, "arrays-hashing": 0.25 },
    ...over,
  };
}

function stubFetch(payload, { ok = true, status = 200 } = {}) {
  globalThis.fetch = async () => ({ ok, status, json: async () => payload });
}

// One fixture serves every query test: four problems spanning strong, weak and
// off-pattern labels, plus a difficulty split.
const FIXTURE = {
  count: 4,
  problems: [
    makeEntry({ slug: "a", title: "A", number: 1, patterns: { intervals: 0.9, greedy: 0.15 } }),
    makeEntry({ slug: "b", title: "B", number: 2, difficulty: "Hard", patterns: { intervals: 0.6 } }),
    makeEntry({ slug: "c", title: "C", number: 3, patterns: { intervals: 0.2 } }),
    makeEntry({ slug: "d", title: "D", number: 4, patterns: { trees: 0.9 } }),
  ],
};
stubFetch(FIXTURE);
await loadCatalog();

describe("slugify", () => {
  test("test_slugify_titleWithSpaces_producesHyphenatedSlug", () => {
    assert.equal(slugify("Merge Intervals"), "merge-intervals");
  });

  test("test_slugify_punctuationAndParens_stripsToCleanSlug", () => {
    assert.equal(slugify("Implement Trie (Prefix Tree)"), "implement-trie-prefix-tree");
  });

  test("test_slugify_leadingAndTrailingSymbols_trimsHyphens", () => {
    assert.equal(slugify("!!Two Sum!!"), "two-sum");
  });

  test("test_slugify_nullOrUndefined_returnsEmptyString", () => {
    assert.equal(slugify(null), "");
    assert.equal(slugify(undefined), "");
  });

  test("test_slugify_alreadyASlug_isIdempotent", () => {
    assert.equal(slugify(slugify("Merge Intervals")), "merge-intervals");
  });
});

describe("savedSlugs", () => {
  test("test_savedSlugs_catalogBackedProblem_matchesOnStoredSlug", () => {
    const set = savedSlugs([{ name: "Merge Intervals", catalogSlug: "merge-intervals" }]);
    assert.ok(set.has("merge-intervals"));
  });

  test("test_savedSlugs_handLoggedProblem_matchesOnDerivedSlug", () => {
    // Problems logged before the catalog existed have no slug, so the name has
    // to be enough to recognize them and avoid recommending a duplicate.
    const set = savedSlugs([{ name: "Merge Intervals" }]);
    assert.ok(set.has("merge-intervals"));
  });

  test("test_savedSlugs_emptyList_returnsEmptySet", () => {
    assert.equal(savedSlugs([]).size, 0);
  });
});

describe("problemUrl", () => {
  test("test_problemUrl_storedUrlPresent_prefersIt", () => {
    assert.equal(problemUrl({ url: "https://example.com/x" }), "https://example.com/x");
  });

  test("test_problemUrl_slugOnly_derivesLeetCodeUrl", () => {
    assert.equal(problemUrl({ catalogSlug: "two-sum" }), "https://leetcode.com/problems/two-sum/");
  });

  test("test_problemUrl_neitherPresent_returnsNull", () => {
    assert.equal(problemUrl({ name: "Hand-written problem" }), null);
  });
});

describe("problemFromCatalog", () => {
  test("test_problemFromCatalog_backlogSave_isUnscheduled", () => {
    const p = problemFromCatalog(makeEntry(), { id: "x", status: STATUS_BACKLOG });
    assert.equal(p.status, STATUS_BACKLOG);
    assert.equal(p.nextReviewDate, null, "a banked problem must not be scheduled");
    assert.equal(p.box, 0);
    assert.deepEqual(p.attempts, []);
  });

  test("test_problemFromCatalog_noExplicitPattern_usesStrongestLabel", () => {
    const p = problemFromCatalog(makeEntry(), { id: "x", status: STATUS_BACKLOG });
    assert.equal(p.patternId, "intervals");
  });

  test("test_problemFromCatalog_explicitPattern_overridesStrongest", () => {
    const p = problemFromCatalog(makeEntry(), { id: "x", status: STATUS_ACTIVE, patternId: "greedy" });
    assert.equal(p.patternId, "greedy");
  });

  test("test_problemFromCatalog_entryWithNoPatterns_stillGetsAPattern", () => {
    const p = problemFromCatalog(makeEntry({ patterns: {} }), { id: "x", status: STATUS_BACKLOG });
    assert.ok(p.patternId, "every problem must belong somewhere or it vanishes from the UI");
  });

  test("test_problemFromCatalog_missingDifficulty_fallsBackToUnrated", () => {
    const p = problemFromCatalog(makeEntry({ difficulty: null }), { id: "x", status: STATUS_BACKLOG });
    assert.equal(p.difficulty, "Unrated");
  });

  test("test_problemFromCatalog_recordStaysSmallEnoughToSync", () => {
    // Guards the constraint directly: state.json syncs through an API that
    // stops serving files past 1 MB, and it is stored pretty-printed.
    const p = problemFromCatalog(makeEntry(), { id: "0123456789abcdef0123456789abcdef0123", status: STATUS_BACKLOG });
    const bytes = Buffer.byteLength(JSON.stringify(p, null, 2));
    assert.ok(bytes < 400, `bank record grew to ${bytes} bytes`);
    const fullBank = bytes * MAX_BANK_SIZE;
    assert.ok(fullBank < 700 * 1024,
      `a full bank would be ${(fullBank / 1024).toFixed(0)} KB, leaving too little room under the 1 MB sync limit`);
  });

  test("test_problemFromCatalog_omitsFieldsNothingReads", () => {
    const p = problemFromCatalog(makeEntry(), { id: "x", status: STATUS_BACKLOG });
    for (const absent of ["resources", "whiteboards", "url", "approach", "filePath", "notes"]) {
      assert.ok(!(absent in p), `${absent} is dead weight on every banked problem`);
    }
  });
});

describe("problemsForPattern", () => {
  test("test_problemsForPattern_weakLabel_isExcluded", async () => {
    const got = await problemsForPattern("intervals");
    assert.deepEqual(got.map((p) => p.slug), ["a", "b"],
      "a 0.2 label is a hint, not a claim, and must not be offered as practice");
  });

  test("test_problemsForPattern_ordersByLabelStrength", async () => {
    const got = await problemsForPattern("intervals");
    assert.equal(got[0].slug, "a");
  });

  test("test_problemsForPattern_difficultyFilter_appliesIt", async () => {
    const got = await problemsForPattern("intervals", { difficulty: "Hard" });
    assert.deepEqual(got.map((p) => p.slug), ["b"]);
  });

  test("test_problemsForPattern_excludedSlugs_areNotRecommended", async () => {
    const got = await problemsForPattern("intervals", { exclude: new Set(["a"]) });
    assert.deepEqual(got.map((p) => p.slug), ["b"]);
  });

  test("test_problemsForPattern_limit_capsResults", async () => {
    assert.equal((await problemsForPattern("intervals", { limit: 1 })).length, 1);
  });

  test("test_problemsForPattern_patternWithNoProblems_returnsEmpty", async () => {
    assert.deepEqual(await problemsForPattern("knapsack"), []);
  });
});

describe("countsByPattern", () => {
  test("test_countsByPattern_countsOnlyConfidentLabels", async () => {
    // The fixture holds intervals at 0.9, 0.6 and 0.2, plus greedy at 0.15.
    const counts = await countsByPattern();
    assert.equal(counts.intervals, 2, "0.9 and 0.6 count toward practice volume; 0.2 does not");
    assert.equal(counts.greedy, undefined,
      "a sub-threshold label is a hint, and must not inflate how much practice a pattern appears to have");
  });

  test("test_countsByPattern_patternWithNoConfidentLabels_isAbsent", async () => {
    const counts = await countsByPattern();
    assert.equal(counts.knapsack, undefined);
  });
});

describe("shared constants", () => {
  test("test_patternConfidence_matchesPythonPositiveThreshold", () => {
    // scripts/taxonomy.py POSITIVE_THRESHOLD. If these drift, the catalog and
    // the training labels disagree about what counts as "this pattern".
    assert.equal(PATTERN_CONFIDENCE, 0.5);
  });
});
