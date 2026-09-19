// Tests for the progress aggregation in js/logic.js.
//
// These answer "am I getting better?", which means they can mislead in a way a
// wrong due-date can't: a chart that flatters you is worse than no chart. The
// cases below pin the choices that keep it honest — reporting null instead of a
// rate derived from one attempt, keeping empty weeks visible rather than
// collapsing a gap, and naming a volume spike rather than celebrating it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  weeklyProgress, patternMovement, progressSummary, todayISO, addDaysISO,
  PROGRESS_WEEKS, STATUS_ACTIVE,
} from "../js/logic.js";

const PATTERNS = [
  { id: "two-pointers", name: "Two Pointers", description: "" },
  { id: "trees", name: "Trees", description: "" },
];

let seq = 0;
function attempt(daysAgo, outcome, insightMin = 10, solveMin = 25) {
  return {
    id: `a${seq++}`,
    date: addDaysISO(todayISO(), -daysAgo),
    outcome,
    patternGuess: "correct",
    timeToInsightMin: insightMin,
    timeToSolveMin: solveMin,
    mistakeTags: [],
    soulStatement: "",
  };
}

function makeState(problems = []) {
  return {
    meta: { schemaVersion: 4 },
    settings: {
      dailyBudgetMin: 75,
      boxIntervalsDays: [0, 1, 3, 7, 16, 35],
      estimateMinByDifficulty: { Easy: 20, Medium: 30, Hard: 45, Unrated: 30 },
      systemDesignUnlockThreshold: { minMocks: 10, minSolvedCleanRate: 0.7 },
    },
    patterns: PATTERNS,
    problems,
    mocks: [], journal: [],
    systemDesign: { manualUnlock: false, sessions: [] },
    streak: { current: 0, longest: 0, lastActiveDate: null },
    resources: {}, whiteboards: [],
    quiz: { totalAsked: 0, totalCorrect: 0, recent: [] },
  };
}

function problemWith(attempts, patternId = "two-pointers") {
  return {
    id: `p${seq++}`, name: "Problem", number: 1, difficulty: "Medium",
    patternId, status: STATUS_ACTIVE, box: 0, nextReviewDate: todayISO(), attempts,
  };
}

describe("weeklyProgress", () => {
  test("test_weeklyProgress_returnsRequestedNumberOfWeeksOldestFirst", () => {
    const rows = weeklyProgress(makeState(), 6);
    assert.equal(rows.length, 6);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1].weekStart < rows[i].weekStart, "weeks must run oldest to newest");
    }
  });

  test("test_weeklyProgress_keepsWeeksWithNoActivity", () => {
    // A gap is part of the story; collapsing it would hide the exact pattern
    // most worth seeing.
    const rows = weeklyProgress(makeState([problemWith([attempt(0, "solved-clean")])]), 4);
    assert.equal(rows.length, 4);
    assert.equal(rows.filter((r) => r.attempts === 0).length, 3);
  });

  test("test_weeklyProgress_singleAttemptWeek_reportsNullRateNotZeroOrOne", () => {
    // One attempt is not a rate. Showing 0% or 100% off a single data point
    // would be the most misleading thing this chart could do.
    const rows = weeklyProgress(makeState([problemWith([attempt(0, "failed")])]), 2);
    assert.equal(rows.at(-1).attempts, 1);
    assert.equal(rows.at(-1).cleanRate, null);
  });

  test("test_weeklyProgress_computesCleanRateOnceThereAreEnoughAttempts", () => {
    const rows = weeklyProgress(makeState([problemWith([
      attempt(0, "solved-clean"), attempt(0, "failed"),
      attempt(1, "solved-clean"), attempt(1, "solved-clean"),
    ])]), 2);
    assert.equal(rows.at(-1).attempts, 4);
    assert.equal(rows.at(-1).cleanRate, 0.75);
  });

  test("test_weeklyProgress_medianInsightIgnoresMissingTimings", () => {
    const rows = weeklyProgress(makeState([problemWith([
      attempt(0, "solved-clean", 4), attempt(0, "solved-clean", 8),
      { ...attempt(0, "solved-clean"), timeToInsightMin: undefined },
    ])]), 1);
    assert.equal(rows.at(-1).medianInsightMin, 6);
  });

  test("test_weeklyProgress_sumsMinutesPractised", () => {
    const rows = weeklyProgress(makeState([problemWith([
      attempt(0, "solved-clean", 5, 20), attempt(0, "failed", 5, 30),
    ])]), 1);
    assert.equal(rows.at(-1).minutes, 50);
  });

  test("test_weeklyProgress_ignoresAttemptsOlderThanTheWindow", () => {
    const rows = weeklyProgress(makeState([problemWith([attempt(200, "solved-clean")])]), 4);
    assert.equal(rows.reduce((s, r) => s + r.attempts, 0), 0);
  });

  test("test_weeklyProgress_emptyState_doesNotThrow", () => {
    assert.doesNotThrow(() => weeklyProgress(makeState(), PROGRESS_WEEKS));
  });
});

describe("patternMovement", () => {
  test("test_patternMovement_improvingPattern_reportsPositiveDelta", () => {
    const state = makeState([problemWith([
      attempt(30, "failed"), attempt(29, "failed"),
      attempt(2, "solved-clean"), attempt(1, "solved-clean"),
    ])]);
    const moved = patternMovement(state, { recent: 2, minEach: 2 });
    const tp = moved.find((m) => m.pattern.id === "two-pointers");
    assert.equal(tp.before, 0);
    assert.equal(tp.after, 1);
    assert.equal(tp.delta, 1);
  });

  test("test_patternMovement_regressingPattern_reportsNegativeDelta", () => {
    const state = makeState([problemWith([
      attempt(30, "solved-clean"), attempt(29, "solved-clean"),
      attempt(2, "failed"), attempt(1, "failed"),
    ])]);
    assert.equal(patternMovement(state, { recent: 2, minEach: 2 })[0].delta, -1);
  });

  test("test_patternMovement_sortsMostImprovedFirst", () => {
    const state = makeState([
      problemWith([attempt(9, "failed"), attempt(8, "failed"), attempt(2, "solved-clean"), attempt(1, "solved-clean")], "two-pointers"),
      problemWith([attempt(9, "solved-clean"), attempt(8, "solved-clean"), attempt(2, "failed"), attempt(1, "failed")], "trees"),
    ]);
    const moved = patternMovement(state, { recent: 2, minEach: 2 });
    assert.equal(moved[0].pattern.id, "two-pointers");
    assert.equal(moved.at(-1).pattern.id, "trees");
  });

  test("test_patternMovement_tooFewAttempts_patternIsOmittedNotShownAsFlat", () => {
    // A pattern practised twice has no trend, and showing it at zero delta
    // would read as "no progress" rather than "not enough evidence".
    const state = makeState([problemWith([attempt(2, "solved-clean"), attempt(1, "failed")])]);
    assert.deepEqual(patternMovement(state, { recent: 2, minEach: 2 }), []);
  });

  test("test_patternMovement_neverAttemptedPattern_isOmitted", () => {
    assert.deepEqual(patternMovement(makeState()), []);
  });
});

describe("progressSummary", () => {
  test("test_progressSummary_tooLittleData_saysSoRatherThanGuessing", () => {
    const summary = progressSummary(makeState(), 4);
    assert.equal(summary.hasEnoughData, false);
    assert.equal(summary.cleanRateDelta, null);
  });

  test("test_progressSummary_improvingOverTime_reportsPositiveCleanRateDelta", () => {
    const state = makeState([problemWith([
      attempt(25, "failed"), attempt(24, "failed"),
      attempt(18, "failed"), attempt(17, "solved-clean"),
      attempt(4, "solved-clean"), attempt(3, "solved-clean"),
      attempt(1, "solved-clean"), attempt(0, "solved-clean"),
    ])]);
    const summary = progressSummary(state, 6);
    assert.ok(summary.hasEnoughData);
    assert.ok(summary.cleanRateDelta > 0, `expected improvement, got ${summary.cleanRateDelta}`);
  });

  test("test_progressSummary_fasterRecognition_reportsNegativeInsightDelta", () => {
    // Time to insight falling is the interview skill actually improving.
    const state = makeState([problemWith([
      attempt(25, "solved-clean", 20), attempt(24, "solved-clean", 22),
      attempt(1, "solved-clean", 5), attempt(0, "solved-clean", 4),
    ])]);
    const summary = progressSummary(state, 6);
    assert.ok(summary.insightDelta < 0, `expected faster recognition, got ${summary.insightDelta}`);
  });

  test("test_progressSummary_volumeSpike_isFlaggedNotCelebrated", () => {
    // The shape that precedes burning out and stopping. Naming it while it's
    // happening is the whole point of this app.
    const steady = [attempt(25, "solved-clean"), attempt(18, "solved-clean"), attempt(11, "solved-clean")];
    const binge = Array.from({ length: 14 }, () => attempt(0, "solved-clean"));
    const summary = progressSummary(makeState([problemWith([...steady, ...binge])]), 6);
    assert.ok(summary.spike, "a week at many times the usual volume should be flagged");
    assert.equal(summary.spike.attempts, 14);
  });

  test("test_progressSummary_steadyPractice_isNotFlaggedAsASpike", () => {
    const even = [0, 7, 14, 21].flatMap((d) => [attempt(d, "solved-clean"), attempt(d, "failed")]);
    assert.equal(progressSummary(makeState([problemWith(even)]), 6).spike, null);
  });

  test("test_progressSummary_countsActiveWeeksAndTotalAttempts", () => {
    const state = makeState([problemWith([attempt(0, "solved-clean"), attempt(8, "failed")])]);
    const summary = progressSummary(state, 6);
    assert.equal(summary.totalAttempts, 2);
    assert.equal(summary.activeWeeks, 2);
  });
});
