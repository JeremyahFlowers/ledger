// Tests for the ranking in js/search.js.
//
// Search degrades quietly: a worse ordering still returns results, still looks
// like it works, and only wastes a second of attention at a time. These pin the
// ordering the design depends on — that an exact title beats a partial one, and
// that a match at a word boundary beats one buried inside a word.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { score } from "../js/search.js";

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
