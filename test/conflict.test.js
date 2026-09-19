// Tests for compareStates in js/logic.js.
//
// This feeds a screen where the user permanently discards one side of their
// own practice history. Being wrong here means either telling someone it's safe
// to discard work that isn't recoverable, or frightening them away from a
// resolution that would have cost nothing. Both are worse than the blind choice
// it replaces, so the comparison has to be exact rather than approximate.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { compareStates, STATUS_ACTIVE, todayISO } from "../js/logic.js";

function attempt(id, over = {}) {
  return {
    id, date: "2026-05-01", outcome: "solved-clean", patternGuess: "correct",
    timeToInsightMin: 6, timeToSolveMin: 20, mistakeTags: [], soulStatement: "", ...over,
  };
}

function stateWith(attempts, extraProblems = 0) {
  const problems = [{
    id: "p1", name: "3Sum", number: 15, difficulty: "Medium", patternId: "two-pointers",
    status: STATUS_ACTIVE, box: 0, nextReviewDate: todayISO(), attempts,
  }];
  for (let i = 0; i < extraProblems; i++) {
    problems.push({ id: `x${i}`, name: `Extra ${i}`, number: null, difficulty: "Medium",
      patternId: "two-pointers", status: STATUS_ACTIVE, box: 0, nextReviewDate: todayISO(), attempts: [] });
  }
  return { patterns: [{ id: "two-pointers", name: "Two Pointers", description: "" }], problems };
}

describe("compareStates", () => {
  test("test_compareStates_identicalHistories_reportsNothingAtStake", () => {
    const a = stateWith([attempt("a1"), attempt("a2")]);
    const b = stateWith([attempt("a1"), attempt("a2")]);
    const diff = compareStates(a, b);
    assert.equal(diff.identical, true);
    assert.equal(diff.attemptsOnlyHere, 0);
    assert.equal(diff.attemptsOnlyThere, 0);
  });

  test("test_compareStates_oneSideStrictlyAhead_namesTheSafeChoice", () => {
    // The common conflict: one device simply hasn't caught up. Choosing the
    // ahead side costs nothing, and saying so removes the fear from the screen.
    const mine = stateWith([attempt("a1")]);
    const theirs = stateWith([attempt("a1"), attempt("a2")]);
    const diff = compareStates(mine, theirs);
    assert.equal(diff.safeChoice, "theirs");
    assert.equal(diff.attemptsOnlyHere, 0);
    assert.equal(diff.attemptsOnlyThere, 1);
  });

  test("test_compareStates_localIsAhead_namesLocalAsSafe", () => {
    const diff = compareStates(stateWith([attempt("a1"), attempt("a2")]), stateWith([attempt("a1")]));
    assert.equal(diff.safeChoice, "mine");
  });

  test("test_compareStates_genuineFork_refusesToNameASafeChoice", () => {
    // Real work on both sides: there is no free option, and pretending
    // otherwise is the one thing this screen must not do.
    const diff = compareStates(stateWith([attempt("a1"), attempt("local")]),
                               stateWith([attempt("a1"), attempt("remote")]));
    assert.equal(diff.safeChoice, null);
    assert.equal(diff.identical, false);
    assert.equal(diff.attemptsOnlyHere, 1);
    assert.equal(diff.attemptsOnlyThere, 1);
  });

  test("test_compareStates_countsAttemptsAcrossAllProblems", () => {
    const mine = {
      patterns: [], problems: [
        { id: "p1", attempts: [attempt("a1")], patternId: "x", name: "A" },
        { id: "p2", attempts: [attempt("a2"), attempt("a3")], patternId: "x", name: "B" },
      ],
    };
    assert.equal(compareStates(mine, stateWith([])).mine.attempts, 3);
  });

  test("test_compareStates_summarizesEachSideForDisplay", () => {
    const mine = stateWith([attempt("a1", { soulStatement: "clicked" }), attempt("a2")], 2);
    const summary = compareStates(mine, stateWith([])).mine;
    assert.equal(summary.problems, 3);
    assert.equal(summary.attempts, 2);
    assert.equal(summary.soulStatements, 1);
    assert.equal(summary.lastActivity, "2026-05-01");
  });

  test("test_compareStates_missingRemote_doesNotThrow", () => {
    // The remote fetch can fail while resolving; the screen still has to render.
    const diff = compareStates(stateWith([attempt("a1")]), null);
    assert.equal(diff.theirs, null);
    assert.equal(diff.attemptsOnlyHere, 1);
  });

  test("test_compareStates_emptyHistories_areIdenticalNotForked", () => {
    const diff = compareStates(stateWith([]), stateWith([]));
    assert.equal(diff.identical, true);
    assert.equal(diff.safeChoice, null);
  });
});
