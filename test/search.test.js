// Tests for the ranking in js/search.js.
//
// Search degrades quietly: a worse ordering still returns results, still looks
// like it works, and only wastes a second of attention at a time. These pin the
// ordering the design depends on — that an exact title beats a partial one, and
// that a match at a word boundary beats one buried inside a word.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { score, groupByKind, collectResults } from "../js/search.js";
import { COMPONENTS } from "../js/design-components.js";

describe("score", () => {
  test("test_score_exactTitle_outranksEverythingElse", () => {
    const exact = score("Two Sum", "two sum");
    assert.ok(exact > score("Two Sum II - Input Array Is Sorted", "two sum"));
    assert.ok(exact > score("Find Two Sum Pairs", "two sum"));
  });

  test("test_score_prefixMatch_outranksAWordBoundaryMatch", () => {
    assert.ok(score("Sliding Window Maximum", "sliding") > score("Longest Sliding Run", "sliding"));
  });

  test("test_score_wordBoundaryMatch_outranksAMatchInsideAWord", () => {
    // "two" in "Add Two Numbers" reads as intentional; inside "network" it does not.
    assert.ok(score("Add Two Numbers", "two") > score("Network Delay Time", "two"));
  });

  test("test_score_noMatch_returnsNull", () => {
    assert.equal(score("Merge Intervals", "quicksort"), null);
  });

  test("test_score_isCaseInsensitive", () => {
    assert.equal(score("MERGE INTERVALS", "merge intervals"), score("merge intervals", "MERGE INTERVALS"));
  });

  test("test_score_emptyQuery_matchesEverythingEqually", () => {
    // An empty box should list things, not rank them arbitrarily.
    assert.equal(score("Two Sum", ""), score("Merge Intervals", ""));
  });

  test("test_score_regexCharactersInQuery_areTreatedAsLiteralText", () => {
    // A query like "C++" or "a[i]" must not blow up the word-boundary test.
    assert.doesNotThrow(() => score("Implement Trie (Prefix Tree)", "trie (prefix"));
    assert.doesNotThrow(() => score("Add Two Numbers", "a[i]+b"));
    assert.equal(score("Regular Expression Matching", "*.+?"), null);
  });

  test("test_score_numberInQuery_matchesAProblemNumber", () => {
    // Callers append the number to the haystack so "15" finds problem 15.
    assert.ok(score("3Sum 15", "15") != null);
  });
});

describe("groupByKind", () => {
  const hit = (kind, title) => ({ kind, title });

  test("test_groupByKind_interleavedKinds_becomeContiguousRuns", () => {
    // Score order alone splits a kind into two runs, which renders as the same
    // group heading appearing twice down the list.
    const grouped = groupByKind([
      hit("pattern", "a"), hit("mine", "b"), hit("pattern", "c"), hit("catalog", "d"),
    ]);
    assert.deepEqual(grouped.map((r) => r.kind), ["pattern", "pattern", "mine", "catalog"]);
  });

  test("test_groupByKind_kindWithTheBestHitComesFirst", () => {
    const grouped = groupByKind([hit("catalog", "a"), hit("pattern", "b")]);
    assert.equal(grouped[0].kind, "catalog", "the strongest match still leads");
  });

  test("test_groupByKind_keepsScoreOrderWithinAKind", () => {
    const grouped = groupByKind([
      hit("pattern", "first"), hit("mine", "x"), hit("pattern", "second"),
    ]);
    assert.deepEqual(grouped.slice(0, 2).map((r) => r.title), ["first", "second"]);
  });

  test("test_groupByKind_losesNothing", () => {
    const input = [hit("pattern", "a"), hit("mine", "b"), hit("catalog", "c"), hit("mine", "d")];
    assert.equal(groupByKind(input).length, input.length);
  });

  test("test_groupByKind_emptyList_returnsEmpty", () => {
    assert.deepEqual(groupByKind([]), []);
  });
});

describe("what is findable", () => {
  // Cycle 4 made soul statements findable, because they are what the app
  // works hardest to collect. Weekly retros were left out, and are arguably
  // the harder thing to find again: a soul statement is one line attached to
  // a problem you can navigate to, and a retro is loose prose in a list that
  // only grows.

  const state = (over = {}) => ({
    patterns: [{ id: "sliding-window", name: "Sliding Window", description: "A moving range." }],
    problems: [], journal: [], ...over,
  });

  const problemWith = (notes) => ({
    id: "p1", name: "3Sum", number: 15, difficulty: "Medium", patternId: "sliding-window",
    status: "active", box: 1, nextReviewDate: "2026-09-24",
    attempts: notes.map((soulStatement, i) => ({
      id: `a${i}`, date: "2026-09-20", outcome: "solved-clean", patternGuess: "correct",
      timeToInsightMin: 5, timeToSolveMin: 20, mistakeTags: [], soulStatement,
    })),
  });

  const kinds = (hits) => hits.map((h) => h.kind);
  const titles = (hits) => hits.map((h) => h.title);

  test("test_search_findsASoulStatement", () => {
    const hits = collectResults(state({ problems: [problemWith(["the window only shrinks from the left"])] }), null, "shrinks");
    assert.ok(titles(hits).includes("the window only shrinks from the left"));
  });

  test("test_search_findsAJournalEntry", () => {
    const hits = collectResults(state({
      journal: [{ id: "j1", date: "2026-09-20", type: "weekly-retro", text: "kept rushing into code" }],
    }), null, "rushing");
    assert.deepEqual(titles(hits), ["kept rushing into code"]);
  });

  test("test_search_aJournalEntryIsAThingYouWrote", () => {
    // Grouped with soul statements rather than given a heading of its own:
    // the question is "where did I write that", not "which feature holds it".
    const hits = collectResults(state({
      journal: [{ id: "j1", date: "2026-09-20", type: "weekly-retro", text: "kept rushing" }],
    }), null, "rushing");
    assert.deepEqual(kinds(hits), ["note"]);
  });

  test("test_search_aJournalHitKnowsItGoesToTheJournal", () => {
    // A soul statement opens its problem; a retro has no problem to open.
    const hits = collectResults(state({
      journal: [{ id: "j1", date: "2026-09-20", type: "weekly-retro", text: "kept rushing" }],
    }), null, "rushing");
    assert.equal(hits[0].source, "journal");
  });

  test("test_search_aSoulStatementHitStillCarriesItsProblem", () => {
    const hits = collectResults(state({ problems: [problemWith(["kept rushing"])] }), null, "rushing");
    assert.equal(hits[0].source, "attempt");
    assert.equal(hits[0].problem.id, "p1");
  });

  test("test_search_aJournalEntrySaysWhatKindItWas", () => {
    const hits = collectResults(state({
      journal: [{ id: "j1", date: "2026-09-20", type: "weekly-retro", text: "kept rushing" }],
    }), null, "rushing");
    assert.match(hits[0].subtitle, /weekly retro · 2026-09-20/);
  });

  test("test_search_anEmptyJournalEntry_isNotAResult", () => {
    // Filtered to notes: titles are searched at one letter, so a bare "a" now
    // legitimately matches component and design-problem names.
    const hits = collectResults(state({
      journal: [{ id: "j1", date: "2026-09-20", type: "note", text: "" }],
    }), null, "a").filter((h) => h.kind === "note");
    assert.deepEqual(hits, []);
  });

  test("test_search_missingJournal_doesNotThrow", () => {
    assert.doesNotThrow(() => collectResults({ patterns: [], problems: [] }, null, "anything"));
  });

  test("test_search_yourOwnProblemsOutrankWhatYouWrote", () => {
    // Both match; the problem is the thing you were probably looking for.
    const hits = collectResults(state({
      problems: [problemWith(["3Sum was hard"])],
      journal: [{ id: "j1", date: "2026-09-20", type: "note", text: "3Sum again" }],
    }), null, "3sum");
    assert.equal(kinds(hits)[0], "mine");
  });

  test("test_search_aSingleLetter_doesNotSearchProse", () => {
    // One letter against every sentence you have ever written returns the
    // whole journal, which is the same as returning nothing. Titles are still
    // searched at one letter, because a title is short enough for the ranking
    // to mean something.
    const withBoth = state({
      problems: [problemWith([])],
      journal: [{ id: "j1", date: "2026-09-20", type: "note", text: "an entry" }],
    });
    assert.deepEqual(collectResults(withBoth, null, "n").filter((h) => h.kind === "note"), []);
  });

  test("test_search_twoLetters_doesSearchProse", () => {
    // "dp" and "bfs" are real queries, so the floor is two and not three.
    const hits = collectResults(state({
      journal: [{ id: "j1", date: "2026-09-20", type: "note", text: "dp is still the weak one" }],
    }), null, "dp");
    assert.equal(hits.length, 1);
  });
});

describe("both halves are findable from one bar", () => {
  // "What was a consistent hash again" is the same question as "what was
  // sliding window again", and should not need a different place to ask it.
  const bare = { patterns: [], problems: [], journal: [] };

  test("test_search_findsAComponentByName", () => {
    const hits = collectResults(bare, null, "consistent hashing");
    assert.equal(hits[0].kind, "component");
    assert.equal(hits[0].id, "consistent-hashing");
  });

  test("test_search_findsADesignProblemByName", () => {
    const hits = collectResults(bare, null, "news feed");
    assert.ok(hits.some((h) => h.kind === "design" && h.id === "news-feed"));
  });

  test("test_search_aComponentCarriesItsHookAsTheSubtitle", () => {
    // So the result list is readable without opening anything.
    const hit = collectResults(bare, null, "consistent hashing")[0];
    assert.ok(hit.subtitle.length > 25);
  });

  test("test_search_aPatternStillOutranksAComponent", () => {
    // Both halves are searchable; the coding half is still what most searches
    // are about, and a tie should not reshuffle on every keystroke.
    const withPattern = { ...bare, patterns: [{ id: "cache-me", name: "Cache", description: "" }] };
    const hits = collectResults(withPattern, null, "cache");
    assert.equal(hits[0].kind, "pattern");
  });

  test("test_search_componentsAreCappedLikeEveryOtherKind", () => {
    // An exact catalog match should not be buried under every component there
    // is. The cap is the app's existing per-group one rather than a number
    // invented for this kind.
    const hits = collectResults(bare, null, "e");
    const components = hits.filter((h) => h.kind === "component").length;
    assert.ok(components > 0, "nothing matched, so the cap is untested");
    assert.ok(components < COMPONENTS.length, `all ${components} components came back uncapped`);
  });
});
