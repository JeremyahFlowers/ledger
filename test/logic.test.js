// Tests for js/logic.js — the domain rules the whole app is built on:
// spaced repetition, the bank/review split, the plant's health model, and the
// session recommender.
//
// These are the functions where a quiet mistake does real damage — a wrong
// Leitner interval silently degrades every future review, and a plant that
// misreads its inputs gives exactly the wrong feedback about burnout. They are
// also pure, so they can be tested directly with no DOM and no network.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  todayISO, addDaysISO, daysBetween, applyOutcome, dueProblems, backlogProblems,
  activateProblem, isBacklog, planToday, allAttempts, patternStats, updateStreak,
  systemDesignUnlock, activityByDate, patternTrend, computePlantState,
  recommendSession, STATUS_ACTIVE, STATUS_BACKLOG,
} from "../js/logic.js";

const SETTINGS = {
  dailyBudgetMin: 75,
  boxIntervalsDays: [0, 1, 3, 7, 16, 35],
  estimateMinByDifficulty: { Easy: 20, Medium: 30, Hard: 45, Unrated: 30 },
  systemDesignUnlockThreshold: { minMocks: 10, minSolvedCleanRate: 0.7 },
};

/** Build a problem without repeating ten default fields in every test. */
function makeProblem(over = {}) {
  return {
    id: over.id || `p-${Math.random().toString(36).slice(2)}`,
    name: "Some Problem",
    number: 1,
    difficulty: "Medium",
    patternId: "two-pointers",
    status: STATUS_ACTIVE,
    box: 0,
    nextReviewDate: todayISO(),
    attempts: [],
    ...over,
  };
}

function makeAttempt(over = {}) {
  return {
    id: "a1", date: todayISO(), outcome: "solved-clean", patternGuess: "correct",
    timeToInsightMin: 5, timeToSolveMin: 20, mistakeTags: [], soulStatement: "",
    ...over,
  };
}

function makeState(over = {}) {
  return {
    meta: { schemaVersion: 4 },
    settings: SETTINGS,
    patterns: [
      { id: "two-pointers", name: "Two Pointers", description: "" },
      { id: "trees", name: "Trees", description: "" },
    ],
    problems: [],
    mocks: [],
    journal: [],
    systemDesign: { manualUnlock: false, sessions: [] },
    streak: { current: 0, longest: 0, lastActiveDate: null },
    resources: {},
    whiteboards: [],
    quiz: { totalAsked: 0, totalCorrect: 0, recent: [] },
    ...over,
  };
}

describe("dates", () => {
  test("test_addDaysISO_positiveOffset_advancesDate", () => {
    assert.equal(addDaysISO("2026-01-01", 1), "2026-01-02");
  });

  test("test_addDaysISO_crossesMonthBoundary_rollsOver", () => {
    assert.equal(addDaysISO("2026-01-31", 1), "2026-02-01");
  });

  test("test_addDaysISO_crossesLeapDay_handles2028", () => {
    assert.equal(addDaysISO("2028-02-28", 1), "2028-02-29");
  });

  test("test_daysBetween_sameDay_returnsZero", () => {
    assert.equal(daysBetween("2026-05-05", "2026-05-05"), 0);
  });

  test("test_daysBetween_laterSecondDate_returnsPositive", () => {
    assert.equal(daysBetween("2026-05-01", "2026-05-08"), 7);
  });

  test("test_daysBetween_earlierSecondDate_returnsNegative", () => {
    assert.equal(daysBetween("2026-05-08", "2026-05-01"), -7);
  });
});

describe("applyOutcome — Leitner scheduling", () => {
  test("test_applyOutcome_solvedClean_promotesOneBox", () => {
    const p = makeProblem({ box: 1 });
    applyOutcome(p, "solved-clean", SETTINGS);
    assert.equal(p.box, 2);
    assert.equal(p.nextReviewDate, addDaysISO(todayISO(), 3));
  });

  test("test_applyOutcome_solvedStruggled_holdsBox", () => {
    const p = makeProblem({ box: 2 });
    applyOutcome(p, "solved-struggled", SETTINGS);
    assert.equal(p.box, 2, "a struggle should not earn a longer interval");
  });

  test("test_applyOutcome_failed_resetsToBoxZero", () => {
    const p = makeProblem({ box: 4 });
    applyOutcome(p, "failed", SETTINGS);
    assert.equal(p.box, 0);
    assert.equal(p.nextReviewDate, todayISO(), "a failure should come back today");
  });

  test("test_applyOutcome_atTopBox_doesNotExceedIntervalTable", () => {
    const p = makeProblem({ box: 5 });
    applyOutcome(p, "solved-clean", SETTINGS);
    assert.equal(p.box, 5, "box must clamp to the last interval");
    assert.equal(p.nextReviewDate, addDaysISO(todayISO(), 35));
  });
});

describe("the bank / review split", () => {
  test("test_dueProblems_backlogProblem_isNeverDue", () => {
    const state = makeState({
      problems: [
        makeProblem({ id: "active", nextReviewDate: todayISO() }),
        makeProblem({ id: "banked", status: STATUS_BACKLOG, nextReviewDate: null }),
      ],
    });
    const due = dueProblems(state).map((p) => p.id);
    assert.deepEqual(due, ["active"]);
  });

  test("test_dueProblems_hundredsBanked_dueCountUnchanged", () => {
    // The regression this split exists to prevent: saving a large bank must not
    // manufacture hundreds of overdue reviews.
    const active = [makeProblem({ id: "a1" }), makeProblem({ id: "a2" })];
    const banked = Array.from({ length: 400 }, (_, i) =>
      makeProblem({ id: `b${i}`, status: STATUS_BACKLOG, nextReviewDate: null }));
    const state = makeState({ problems: [...active, ...banked] });
    assert.equal(dueProblems(state).length, 2);
    assert.equal(backlogProblems(state).length, 400);
  });

  test("test_dueProblems_missingNextReviewDateOnActive_treatedAsDue", () => {
    // Seeded problems predate the field; they should still surface.
    const state = makeState({ problems: [makeProblem({ nextReviewDate: undefined })] });
    assert.equal(dueProblems(state).length, 1);
  });

  test("test_dueProblems_weakestBoxFirst_ordersByBoxThenDate", () => {
    const state = makeState({
      problems: [
        makeProblem({ id: "strong", box: 4, nextReviewDate: "2026-01-01" }),
        makeProblem({ id: "weak", box: 0, nextReviewDate: "2026-01-02" }),
      ],
    });
    assert.deepEqual(dueProblems(state).map((p) => p.id), ["weak", "strong"]);
  });

  test("test_isBacklog_legacyProblemWithoutStatus_readsAsActive", () => {
    assert.equal(isBacklog(makeProblem({ status: undefined })), false);
  });

  test("test_backlogProblems_filteredByPattern_returnsOnlyThatPattern", () => {
    const state = makeState({
      problems: [
        makeProblem({ status: STATUS_BACKLOG, patternId: "trees" }),
        makeProblem({ status: STATUS_BACKLOG, patternId: "two-pointers" }),
      ],
    });
    assert.equal(backlogProblems(state, "trees").length, 1);
  });

  test("test_activateProblem_backlogProblem_entersRotationDueToday", () => {
    const p = makeProblem({ status: STATUS_BACKLOG, nextReviewDate: null });
    activateProblem(p);
    assert.equal(p.status, STATUS_ACTIVE);
    assert.equal(p.nextReviewDate, todayISO());
  });

  test("test_activateProblem_alreadyActive_leavesScheduleUntouched", () => {
    const p = makeProblem({ status: STATUS_ACTIVE, box: 3, nextReviewDate: "2026-12-01" });
    activateProblem(p);
    assert.equal(p.nextReviewDate, "2026-12-01", "must not reset an existing schedule");
    assert.equal(p.box, 3);
  });
});

describe("planToday", () => {
  test("test_planToday_withinBudget_includesAll", () => {
    const state = makeState({ problems: [makeProblem({ difficulty: "Easy" }), makeProblem({ difficulty: "Easy" })] });
    const { plan, overflow, usedMin } = planToday(state);
    assert.equal(plan.length, 2);
    assert.equal(overflow.length, 0);
    assert.equal(usedMin, 40);
  });

  test("test_planToday_overBudget_pushesRestToOverflow", () => {
    const problems = Array.from({ length: 5 }, () => makeProblem({ difficulty: "Hard" })); // 45 min each
    const { plan, overflow } = planToday(makeState({ problems }));
    assert.equal(plan.length, 1, "75-min budget fits one 45-min problem before the next would exceed it");
    assert.equal(overflow.length, 4);
  });

  test("test_planToday_firstProblemExceedsBudget_stillIncludesIt", () => {
    // Never return an empty plan: one too-long problem is better than nothing.
    const state = makeState({
      settings: { ...SETTINGS, dailyBudgetMin: 10 },
      problems: [makeProblem({ difficulty: "Hard" })],
    });
    assert.equal(planToday(state).plan.length, 1);
  });

  test("test_planToday_unknownDifficulty_fallsBackToDefaultEstimate", () => {
    const state = makeState({ problems: [makeProblem({ difficulty: "Legendary" })] });
    assert.equal(planToday(state).usedMin, 30);
  });

  test("test_planToday_bankedProblems_excludedFromPlan", () => {
    const state = makeState({
      problems: [makeProblem({ status: STATUS_BACKLOG, nextReviewDate: null })],
    });
    assert.equal(planToday(state).plan.length, 0);
  });
});

describe("attempts and pattern stats", () => {
  test("test_allAttempts_multipleProblems_sortedByDate", () => {
    const state = makeState({
      problems: [
        makeProblem({ attempts: [makeAttempt({ id: "late", date: "2026-03-02" })] }),
        makeProblem({ attempts: [makeAttempt({ id: "early", date: "2026-03-01" })] }),
      ],
    });
    assert.deepEqual(allAttempts(state).map((a) => a.id), ["early", "late"]);
  });

  test("test_allAttempts_filteredByPattern_returnsOnlyThatPattern", () => {
    const state = makeState({
      problems: [
        makeProblem({ patternId: "trees", attempts: [makeAttempt()] }),
        makeProblem({ patternId: "two-pointers", attempts: [makeAttempt()] }),
      ],
    });
    assert.equal(allAttempts(state, "trees").length, 1);
  });

  test("test_patternStats_noAttempts_reportsNullRateNotZero", () => {
    // Null and zero mean different things: "never tried" must not rank as
    // "always failed", or the recommender sends you to untouched patterns
    // believing they're your weakest.
    const stats = patternStats(makeState()).find((s) => s.pattern.id === "trees");
    assert.equal(stats.attempts, 0);
    assert.equal(stats.solvedCleanRate, null);
  });

  test("test_patternStats_mixedOutcomes_computesCleanSolveRate", () => {
    const state = makeState({
      problems: [makeProblem({
        patternId: "trees",
        attempts: [
          makeAttempt({ outcome: "solved-clean" }),
          makeAttempt({ outcome: "failed" }),
        ],
      })],
    });
    const stats = patternStats(state).find((s) => s.pattern.id === "trees");
    assert.equal(stats.solvedCleanRate, 0.5);
  });

  test("test_patternTrend_ordersOldestFirst", () => {
    const state = makeState({
      problems: [makeProblem({
        patternId: "trees",
        attempts: [
          makeAttempt({ date: "2026-01-01", outcome: "failed" }),
          makeAttempt({ date: "2026-01-05", outcome: "solved-clean" }),
        ],
      })],
    });
    const trend = patternTrend(state, "trees");
    assert.equal(trend.length, 2);
    assert.ok(trend[1] > trend[0], "improvement should read as a rising series");
  });

  test("test_activityByDate_multipleAttemptsSameDay_countsAll", () => {
    const state = makeState({
      problems: [makeProblem({ attempts: [makeAttempt({ date: "2026-02-02" }), makeAttempt({ date: "2026-02-02" })] })],
    });
    assert.equal(activityByDate(state)["2026-02-02"], 2);
  });
});

describe("updateStreak", () => {
  test("test_updateStreak_firstEverActivity_startsAtOne", () => {
    const state = makeState();
    updateStreak(state);
    assert.equal(state.streak.current, 1);
    assert.equal(state.streak.longest, 1);
  });

  test("test_updateStreak_consecutiveDay_increments", () => {
    const state = makeState({ streak: { current: 3, longest: 5, lastActiveDate: addDaysISO(todayISO(), -1) } });
    updateStreak(state);
    assert.equal(state.streak.current, 4);
  });

  test("test_updateStreak_gapInDays_resetsToOne", () => {
    const state = makeState({ streak: { current: 9, longest: 9, lastActiveDate: addDaysISO(todayISO(), -3) } });
    updateStreak(state);
    assert.equal(state.streak.current, 1);
    assert.equal(state.streak.longest, 9, "a broken streak must not erase the record");
  });

  test("test_updateStreak_sameDayTwice_doesNotDoubleCount", () => {
    const state = makeState({ streak: { current: 2, longest: 2, lastActiveDate: todayISO() } });
    updateStreak(state);
    assert.equal(state.streak.current, 2);
  });
});

describe("systemDesignUnlock", () => {
  test("test_systemDesignUnlock_belowThresholds_staysLocked", () => {
    assert.equal(systemDesignUnlock(makeState()).unlocked, false);
  });

  test("test_systemDesignUnlock_manualOverride_unlocksRegardless", () => {
    const state = makeState({ systemDesign: { manualUnlock: true, sessions: [] } });
    assert.equal(systemDesignUnlock(state).unlocked, true);
  });
});

describe("computePlantState", () => {
  test("test_computePlantState_bankedProblems_doNotCountAsOverdue", () => {
    // The specific regression: a large bank left untouched for a month must not
    // read as hundreds of neglected reviews and wilt the plant.
    const banked = Array.from({ length: 300 }, () =>
      makeProblem({ status: STATUS_BACKLOG, nextReviewDate: addDaysISO(todayISO(), -60) }));
    const withBank = computePlantState(makeState({ problems: banked }));
    const withoutBank = computePlantState(makeState({ problems: [] }));
    assert.equal(withBank.health, withoutBank.health);
  });

  test("test_computePlantState_longNeglectedRealReviews_reduceHealth", () => {
    // Both sides carry practice history, because neglect only means something
    // once there is practice to have lapsed from: a problem you have never
    // opened isn't neglected, it's unstarted. See the totalDaysPracticed early
    // return in computePlantState.
    const oldAttempt = (daysAgo) => ({
      id: `a${daysAgo}`, date: addDaysISO(todayISO(), -daysAgo), outcome: "solved-clean",
      patternGuess: "correct", timeToInsightMin: 5, timeToSolveMin: 20,
      mistakeTags: [], soulStatement: "",
    });
    const neglected = Array.from({ length: 10 }, () =>
      makeProblem({ nextReviewDate: addDaysISO(todayISO(), -30), attempts: [oldAttempt(40)] }));
    const kept = [makeProblem({ nextReviewDate: addDaysISO(todayISO(), 5), attempts: [oldAttempt(40)] })];
    assert.ok(computePlantState(makeState({ problems: neglected })).health
            < computePlantState(makeState({ problems: kept })).health,
      "reviews left long after you actually worked them should show");
  });

  test("test_computePlantState_unstartedProblems_areNotTreatedAsNeglect", () => {
    // Seeding an account with problems you have not begun must not read as a
    // pile of things you are already behind on.
    const seeded = Array.from({ length: 23 }, () =>
      makeProblem({ nextReviewDate: addDaysISO(todayISO(), -30) }));
    const plant = computePlantState(makeState({ problems: seeded }));
    assert.equal(plant.signals.overdueCount, 0);
    assert.notEqual(plant.vitality, "wilting");
  });

  test("test_computePlantState_healthAlwaysWithinBounds", () => {
    const brutal = makeState({
      problems: Array.from({ length: 500 }, () => makeProblem({ nextReviewDate: "2020-01-01" })),
      streak: { current: 0, longest: 0, lastActiveDate: "2020-01-01" },
    });
    const plant = computePlantState(brutal);
    assert.ok(plant.health >= 0 && plant.health <= 100, `health out of range: ${plant.health}`);
  });

  test("test_computePlantState_vitalityLabel_matchesHealthBand", () => {
    const plant = computePlantState(makeState());
    assert.ok(["thriving", "steady", "stressed", "wilting"].includes(plant.vitality));
  });

  test("test_computePlantState_emptyState_doesNotThrow", () => {
    assert.doesNotThrow(() => computePlantState(makeState()));
  });
});

describe("recommendSession", () => {
  test("test_recommendSession_nothingDueButBankHasWork_offersFreshVolume", () => {
    const state = makeState({
      problems: [
        makeProblem({ id: "future", nextReviewDate: addDaysISO(todayISO(), 30) }),
        makeProblem({ id: "banked", status: STATUS_BACKLOG, nextReviewDate: null, patternId: "trees" }),
      ],
    });
    const rec = recommendSession(state);
    assert.equal(rec.type, "fresh-volume");
    assert.equal(rec.problem.id, "banked");
  });

  test("test_recommendSession_nothingDueAndEmptyBank_reportsFreeDay", () => {
    const state = makeState({
      problems: [makeProblem({ nextReviewDate: addDaysISO(todayISO(), 30) })],
    });
    assert.equal(recommendSession(state).type, "none");
  });

  test("test_recommendSession_dueWorkExists_prefersItOverTheBank", () => {
    const state = makeState({
      problems: [
        makeProblem({ id: "due", nextReviewDate: todayISO() }),
        makeProblem({ id: "banked", status: STATUS_BACKLOG, nextReviewDate: null }),
      ],
    });
    const rec = recommendSession(state);
    assert.equal(rec.type, "first-rep");
    assert.equal(rec.problem.id, "due");
  });

  test("test_recommendSession_everyRecommendation_carriesAReason", () => {
    // The whole point of the recommender is that it explains itself.
    const state = makeState({
      problems: [makeProblem({ status: STATUS_BACKLOG, nextReviewDate: null })],
    });
    const rec = recommendSession(state);
    assert.ok(rec.message && rec.message.length > 10, "a recommendation without a reason is a black box");
  });
});
