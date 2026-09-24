// Tests for ordering and sampling the problem bank (js/bank-view.js).
//
// 2,500 rows in catalog order with filters but no ordering, and no way to say
// "just give me one". Catalog order is arbitrary, so the top of the list was
// an arbitrary place to start — and deciding what to work on is its own tax,
// which scanning 2,500 rows to avoid is not a good trade.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SORTS, sortMatches, pickOne } from "../js/bank-view.js";

const p = (number, difficulty, title, patterns = {}) => ({ number, difficulty, title, patterns, slug: title.toLowerCase() });

const ROWS = [
  p(30, "Hard", "Substring Concatenation", { "sliding-window": 0.9 }),
  p(1, "Easy", "Two Sum", { "arrays-hashing": 0.95 }),
  p(11, "Medium", "Container With Most Water", { "two-pointers": 0.4 }),
];

describe("SORTS", () => {
  test("test_sorts_everyOptionHasALabel", () => {
    // The <select> is built from this table, so an option without a label
    // would render blank.
    for (const [key, sort] of Object.entries(SORTS)) {
      assert.ok(sort.label && sort.label.length > 2, `${key} needs a label`);
    }
  });
});

describe("sortMatches", () => {
  test("test_sortMatches_byNumber_ascends", () => {
    assert.deepEqual(sortMatches(ROWS, "number").map((r) => r.number), [1, 11, 30]);
  });

  test("test_sortMatches_easiestFirst", () => {
    assert.deepEqual(sortMatches(ROWS, "difficulty").map((r) => r.difficulty), ["Easy", "Medium", "Hard"]);
  });

  test("test_sortMatches_hardestFirst", () => {
    assert.deepEqual(sortMatches(ROWS, "hardest").map((r) => r.difficulty), ["Hard", "Medium", "Easy"]);
  });

  test("test_sortMatches_titleAlphabetical", () => {
    assert.equal(sortMatches(ROWS, "title")[0].title, "Container With Most Water");
  });

  test("test_sortMatches_byConfidence_ranksTheSelectedPatternFirst", () => {
    const rows = [p(1, "Easy", "Weak", { "two-pointers": 0.2 }), p(2, "Easy", "Strong", { "two-pointers": 0.9 })];
    assert.equal(sortMatches(rows, "confidence", "two-pointers")[0].title, "Strong");
  });

  test("test_sortMatches_byConfidenceWithNoPattern_fallsBackToNumber", () => {
    // Ranking by a confidence that isn't there would be an arbitrary order
    // presented as a meaningful one.
    assert.deepEqual(sortMatches(ROWS, "confidence", "").map((r) => r.number), [1, 11, 30]);
  });

  test("test_sortMatches_unknownKey_doesNotThrow", () => {
    assert.equal(sortMatches(ROWS, "nonsense").length, 3);
  });

  test("test_sortMatches_doesNotMutateTheInput", () => {
    const before = ROWS.map((r) => r.number);
    sortMatches(ROWS, "difficulty");
    assert.deepEqual(ROWS.map((r) => r.number), before);
  });

  test("test_sortMatches_missingNumbers_sinkRatherThanCrash", () => {
    const rows = [p(undefined, "Easy", "No number"), p(5, "Easy", "Has one")];
    assert.equal(sortMatches(rows, "number")[0].title, "Has one");
  });

  test("test_sortMatches_emptyList_isEmpty", () => {
    assert.deepEqual(sortMatches([], "number"), []);
  });
});

describe("pickOne", () => {
  test("test_pickOne_returnsSomethingFromTheList", () => {
    assert.ok(ROWS.includes(pickOne(ROWS, () => 0.5)));
  });

  test("test_pickOne_canReachTheFirstAndLast", () => {
    assert.equal(pickOne(ROWS, () => 0).title, ROWS[0].title);
    assert.equal(pickOne(ROWS, () => 0.999).title, ROWS.at(-1).title);
  });

  test("test_pickOne_randomAtExactlyOne_staysInBounds", () => {
    // Math.random() never returns 1, but a caller's stub might.
    assert.ok(pickOne(ROWS, () => 1) !== undefined);
  });

  test("test_pickOne_emptyList_isNull", () => {
    assert.equal(pickOne([], () => 0.5), null);
  });
});
