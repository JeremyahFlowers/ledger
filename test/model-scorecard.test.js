// Tests for modelScorecard (js/stats.js).
//
// The pattern model ships with numbers from a held-out split of a public
// corpus. Those describe problems in general; they say nothing about the ones
// this user pastes in. The app has held the data to answer that since Analyze
// shipped — a stored prediction on every tracked problem, and the pattern the
// problem settled on — and never once looked at it.
//
// The cases below pin the honesty rules as much as the counting: no rate below
// the minimum sample, disagreements reported by name because they are the half
// with no anchoring doubt in them, and nothing invented for a problem that was
// never analysed.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { modelScorecard, SCORECARD_MIN } from "../js/stats.js";

const analysed = (id, actual, ranked, at = "2026-09-01") => ({
  id, name: `Problem ${id}`, patternId: actual,
  analysis: { at, predictions: ranked.map((pattern, i) => ({ pattern, probability: 0.9 - i * 0.2 })) },
});

/** `n` problems the model got right, to push a case over the sample minimum. */
const rights = (n, from = 0) =>
  Array.from({ length: n }, (_, i) => analysed(`r${from + i}`, "two-pointers", ["two-pointers", "dp"]));

describe("counting", () => {
  test("test_scorecard_firstGuessRight_countsTowardBoth", () => {
    const card = modelScorecard({ problems: [analysed("a", "dp", ["dp", "greedy"])] });
    assert.equal(card.top1, 1);
    assert.equal(card.top3, 1);
  });

  test("test_scorecard_rightButNotFirst_countsOnlyTowardTopThree", () => {
    const card = modelScorecard({ problems: [analysed("a", "dp", ["greedy", "dp"])] });
    assert.equal(card.top1, 0);
    assert.equal(card.top3, 1);
  });

  test("test_scorecard_missedEntirely_countsTowardNeither", () => {
    const card = modelScorecard({ problems: [analysed("a", "bfs", ["greedy", "dp"])] });
    assert.equal(card.top1, 0);
    assert.equal(card.top3, 0);
    assert.equal(card.n, 1);
  });

  test("test_scorecard_problemNeverAnalysed_isNotJudged", () => {
    // Most problems are typed in or come from the bank. Counting them as
    // misses would invent a failure the model never had a chance at.
    const card = modelScorecard({ problems: [{ id: "x", name: "X", patternId: "dp" }] });
    assert.equal(card.n, 0);
  });

  test("test_scorecard_analysedButNoPatternRecorded_isNotJudged", () => {
    // There is nothing to grade against yet.
    const card = modelScorecard({ problems: [{ ...analysed("a", "dp", ["dp"]), patternId: null }] });
    assert.equal(card.n, 0);
  });

  test("test_scorecard_emptyState_doesNotThrow", () => {
    assert.equal(modelScorecard({ problems: [] }).n, 0);
    assert.equal(modelScorecard({}).n, 0);
  });
});

describe("what it refuses to claim", () => {
  test("test_scorecard_belowTheMinimum_reportsNoRate", () => {
    // A percentage over three problems is noise with a decimal point on it.
    const card = modelScorecard({ problems: rights(SCORECARD_MIN - 1) });
    assert.equal(card.enough, false);
    assert.equal(card.top1Rate, null);
    assert.equal(card.top3Rate, null);
  });

  test("test_scorecard_belowTheMinimum_saysHowManyMore", () => {
    const card = modelScorecard({ problems: rights(3) });
    assert.equal(card.needed, SCORECARD_MIN - 3);
  });

  test("test_scorecard_atTheMinimum_startsReporting", () => {
    const card = modelScorecard({ problems: rights(SCORECARD_MIN) });
    assert.equal(card.enough, true);
    assert.equal(card.top1Rate, 1);
    assert.equal(card.needed, 0);
  });

  test("test_scorecard_rateIsOverEverythingJudged_notOverTheRightAnswers", () => {
    const problems = [...rights(SCORECARD_MIN - 2), analysed("m1", "bfs", ["dp"]), analysed("m2", "bfs", ["dp"])];
    const card = modelScorecard({ problems });
    assert.equal(card.n, SCORECARD_MIN);
    assert.equal(card.top1Rate, (SCORECARD_MIN - 2) / SCORECARD_MIN);
  });
});

describe("disagreements", () => {
  test("test_scorecard_namesWhatItSaidAndWhatYouRecorded", () => {
    const card = modelScorecard({ problems: [analysed("a", "dp", ["greedy", "dp"])] });
    assert.equal(card.disagreements.length, 1);
    assert.deepEqual(
      { said: card.disagreements[0].said, actual: card.disagreements[0].actual },
      { said: "greedy", actual: "dp" },
    );
  });

  test("test_scorecard_carriesHowSureItWas", () => {
    // "It said greedy" and "it said greedy at 90%" are different admissions.
    const card = modelScorecard({ problems: [analysed("a", "dp", ["greedy"])] });
    assert.equal(card.disagreements[0].saidProbability, 0.9);
  });

  test("test_scorecard_aRightAnswerLowerDownIsStillADisagreement", () => {
    // Top-three credit doesn't erase that its first answer was overruled.
    const card = modelScorecard({ problems: [analysed("a", "dp", ["greedy", "dp"])] });
    assert.equal(card.top3, 1);
    assert.equal(card.disagreements.length, 1);
  });

  test("test_scorecard_newestFirst", () => {
    // These are worth reading because you can still remember the problem.
    const card = modelScorecard({ problems: [
      analysed("old", "dp", ["greedy"], "2026-01-01"),
      analysed("new", "dp", ["greedy"], "2026-09-01"),
    ] });
    assert.deepEqual(card.disagreements.map((d) => d.problemId), ["new", "old"]);
  });

  test("test_scorecard_carriesTheProblemIdSoItCanBeOpened", () => {
    const card = modelScorecard({ problems: [analysed("a", "dp", ["greedy"])] });
    assert.equal(card.disagreements[0].problemId, "a");
    assert.equal(card.disagreements[0].problemName, "Problem a");
  });

  test("test_scorecard_agreedEveryTime_reportsAnEmptyListNotNull", () => {
    assert.deepEqual(modelScorecard({ problems: rights(3) }).disagreements, []);
  });

  test("test_scorecard_disagreementsAreListedBelowTheMinimum_too", () => {
    // The rate is withheld for want of a sample; an individual overrule is a
    // fact about one problem and needs no sample at all.
    const card = modelScorecard({ problems: [analysed("a", "dp", ["greedy"])] });
    assert.equal(card.enough, false);
    assert.equal(card.disagreements.length, 1);
  });
});
