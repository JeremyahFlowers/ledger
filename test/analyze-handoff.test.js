// Tests for the title guess when tracking a pasted problem
// (js/analyze-view.js).
//
// Analyze takes arbitrary pasted text, so the name has to be guessed. The
// field is editable, which makes a wrong guess cheap — but an absurd one
// (half a statement as a title) is worse than an empty box, because it looks
// deliberate and gets saved.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { firstLineAsTitle } from "../js/analyze-view.js";

describe("firstLineAsTitle", () => {
  test("test_firstLine_aTitleLine_isUsed", () => {
    assert.equal(firstLineAsTitle("Two Sum\n\nGiven an array of integers..."), "Two Sum");
  });

  test("test_firstLine_skipsLeadingBlankLines", () => {
    assert.equal(firstLineAsTitle("\n\n  Valid Parentheses  \nGiven a string..."), "Valid Parentheses");
  });

  test("test_firstLine_stripsALeetCodeStyleNumberPrefix", () => {
    assert.equal(firstLineAsTitle("1. Two Sum\nGiven an array"), "Two Sum");
    assert.equal(firstLineAsTitle("11) Container With Most Water"), "Container With Most Water");
  });

  test("test_firstLine_aStatementSentence_isNotATitle", () => {
    // Pasting straight into the statement is at least as common as pasting a
    // title, and "Given an array of integers nums, return..." is not a name.
    assert.equal(firstLineAsTitle("Given an array of integers nums, return indices of the two numbers."), "");
  });

  test("test_firstLine_endingInSentencePunctuation_isNotATitle", () => {
    assert.equal(firstLineAsTitle("Find the median."), "");
    assert.equal(firstLineAsTitle("Constraints:"), "");
  });

  test("test_firstLine_aLongLine_isNotATitle", () => {
    const long = "A".repeat(80);
    assert.equal(firstLineAsTitle(long), "");
  });

  test("test_firstLine_emptyInput_isEmptyNotUndefined", () => {
    assert.equal(firstLineAsTitle(""), "");
    assert.equal(firstLineAsTitle(null), "");
    assert.equal(firstLineAsTitle("   \n  "), "");
  });
});
