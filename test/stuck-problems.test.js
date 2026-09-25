// Noticing a problem that isn't going in (js/logic.js).
//
// Three failed attempts in a row reset it to box 0 each time, so it came back
// the next day, and nothing anywhere noticed. recommendSession had a deep-dive
// for a weak *pattern* and no equivalent for a problem that is not working —
// so the app's answer to "I have failed this three times" was to serve it
// again tomorrow. That is grinding harder and calling it progress, which this
// app's own source comments say it exists to prevent, prescribed by the app.
//
// Deliberately about a problem rather than a pattern: they are different
// failures with different answers. A weak pattern means you have not learned
// the technique. A stuck problem often means you have, and this one is not the
// way to practise it today.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { stuckProblems, STUCK_ATTEMPTS, recommendSession, todayISO, addDaysISO } from "../js/logic.js";

let n = 0;
const at = (date, outcome) => ({
  id: `a${n++}`, date, outcome, patternGuess: "incorrect",
  timeToInsightMin: 20, timeToSolveMin: 45, mistakeTags: [], soulStatement: "",
});
const daysAgo = (d) => addDaysISO(todayISO(), -d);

const problem = (attempts, over = {}) => ({
  id: "p1", name: "Median of Two Sorted Arrays", number: 4, difficulty: "Hard",
  patternId: "binary-search", status: "active", box: 0, nextReviewDate: todayISO(),
  attempts, ...over,
});
const st = (problems) => ({ problems, patterns: [], mocks: [], journal: [] });

describe("what counts as stuck", () => {
  test("test_stuck_threeFailuresInARow_isStuck", () => {
    const found = stuckProblems(st([problem([at(daysAgo(20), "failed"), at(daysAgo(12), "failed"), at(daysAgo(3), "failed")])]));
    assert.equal(found.length, 1);
    assert.equal(found[0].run, 3);
  });

  test("test_stuck_twoFailures_isNotYet", () => {
    // Two bad attempts on a hard problem is normal, and being told to stop
    // after them would be both wrong and irritating.
    assert.deepEqual(stuckProblems(st([problem([at(daysAgo(12), "failed"), at(daysAgo(3), "failed")])])), []);
  });

  test("test_stuck_theThresholdIsWhatSTUCK_ATTEMPTSSays", () => {
    const run = (k) => stuckProblems(st([problem(Array.from({ length: k }, (_, i) => at(daysAgo(30 - i), "failed")))]));
    assert.equal(run(STUCK_ATTEMPTS).length, 1);
    assert.equal(run(STUCK_ATTEMPTS - 1).length, 0);
  });

  test("test_stuck_ranOutOfTimeCountsToo", () => {
    // Not solving it because the clock went is still not solving it, and three
    // of those is the same signal.
    const found = stuckProblems(st([problem([
      at(daysAgo(20), "ran-out-of-time"), at(daysAgo(12), "failed"), at(daysAgo(3), "ran-out-of-time"),
    ])]));
    assert.equal(found.length, 1);
  });

  test("test_stuck_struggledThroughItIsNotStuck", () => {
    // Struggling through it is the thing working. Counting it as failure would
    // tell people to stop doing the hard reps that are the point.
    assert.deepEqual(stuckProblems(st([problem([
      at(daysAgo(20), "failed"), at(daysAgo(12), "solved-struggled"), at(daysAgo(3), "failed"),
    ])])), []);
  });

  test("test_stuck_aCleanSolveEndsTheRun", () => {
    assert.deepEqual(stuckProblems(st([problem([
      at(daysAgo(30), "failed"), at(daysAgo(20), "failed"), at(daysAgo(12), "failed"),
      at(daysAgo(3), "solved-clean"),
    ])])), []);
  });

  test("test_stuck_onlyTheMostRecentAttemptsCount", () => {
    // An old bad run you later fixed is history, not a warning.
    assert.deepEqual(stuckProblems(st([problem([
      at(daysAgo(60), "failed"), at(daysAgo(50), "failed"), at(daysAgo(40), "failed"),
      at(daysAgo(10), "solved-clean"), at(daysAgo(3), "solved-clean"),
    ])])), []);
  });

  test("test_stuck_countsTheWholeRunNotJustTheWindow", () => {
    // Five in a row should say five, so the message is not permanently "three".
    const found = stuckProblems(st([problem(
      Array.from({ length: 5 }, (_, i) => at(daysAgo(50 - i * 10), "failed")))]));
    assert.equal(found[0].run, 5);
  });

  test("test_stuck_unorderedAttempts_areSortedBeforeBeingJudged", () => {
    const found = stuckProblems(st([problem([
      at(daysAgo(3), "failed"), at(daysAgo(30), "solved-clean"), at(daysAgo(12), "failed"), at(daysAgo(20), "failed"),
    ])]));
    assert.equal(found.length, 1, "the trailing run is the three failures, whatever order they arrived in");
  });

  test("test_stuck_worstFirst", () => {
    const five = problem(Array.from({ length: 5 }, (_, i) => at(daysAgo(50 - i * 5), "failed")), { id: "five", name: "Five" });
    const three = problem(Array.from({ length: 3 }, (_, i) => at(daysAgo(30 - i * 5), "failed")), { id: "three", name: "Three" });
    assert.deepEqual(stuckProblems(st([three, five])).map((s) => s.problem.id), ["five", "three"]);
  });

  test("test_stuck_emptyAndMissingData_doNotThrow", () => {
    assert.deepEqual(stuckProblems(st([])), []);
    assert.deepEqual(stuckProblems({}), []);
    assert.deepEqual(stuckProblems(st([{ id: "x", name: "X", patternId: "p" }])), []);
  });
});

describe("what the app then recommends", () => {
  const stuckState = () => ({
    ...st([problem([at(daysAgo(20), "failed"), at(daysAgo(12), "failed"), at(todayISO(), "failed")])]),
    patterns: [{ id: "binary-search", name: "Binary Search", description: "" }],
    settings: { dailyBudgetMin: 75, boxIntervalsDays: [0, 1, 3, 7, 16, 35], estimateMinByDifficulty: { Hard: 45 } },
    systemDesign: { manualUnlock: false, sessions: [] },
    streak: { current: 0, longest: 0, lastActiveDate: null },
  });

  test("test_recommend_aStuckProblem_isItsOwnKindOfRecommendation", () => {
    assert.equal(recommendSession(stuckState()).type, "stuck");
  });

  test("test_recommend_stuckMessageNamesTheProblemAndTheRun", () => {
    const rec = recommendSession(stuckState());
    assert.match(rec.message, /Median of Two Sorted Arrays/);
    assert.match(rec.message, /3 attempts/);
  });

  test("test_recommend_stuckMessageDoesNotAskForAnotherAttempt", () => {
    // The entire point. If this reads as "try again", nothing has changed.
    const rec = recommendSession(stuckState());
    assert.match(rec.message, /unlikely to be the thing that works/);
  });

  test("test_recommend_stuckStillCarriesTheProblemAndItsPattern", () => {
    // The card offers reading the pattern and seeing what you tried; both need
    // these.
    const rec = recommendSession(stuckState());
    assert.equal(rec.problem.id, "p1");
    assert.equal(rec.patternId, "binary-search");
  });
});
