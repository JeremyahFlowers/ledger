// Tests for the daily-budget clock in js/logic.js.
//
// The budget is the app's one explicit limit on itself — the number that says
// "this is enough for today" — so the clock that reports against it has to be
// exactly right in the cases where it would otherwise quietly lie: a timer
// left running overnight, a start that arrives twice, a stop that never came.
// Over-reporting the day would tell someone they'd overdone it when they
// hadn't, which is the one thing that would make them stop trusting it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  newDayTimer, startDayTimer, stopDayTimer, resetDayTimer, dayTimerElapsedMs,
  budgetProgress, budgetPressure, todayISO, addDaysISO, OVERRUN_MULTIPLE, STATUS_ACTIVE,
} from "../js/logic.js";

const MIN = 60000;

function makeState({ budget = 75, attempts = [], dayTimer = undefined } = {}) {
  return {
    settings: { dailyBudgetMin: budget },
    patterns: [{ id: "two-pointers", name: "Two Pointers", description: "" }],
    problems: attempts.length
      ? [{ id: "p1", name: "P", number: 1, difficulty: "Medium", patternId: "two-pointers",
           status: STATUS_ACTIVE, box: 0, nextReviewDate: todayISO(), attempts }]
      : [],
    streak: { current: 0, longest: 0, lastActiveDate: null },
    quiz: { totalAsked: 0, totalCorrect: 0, recent: [] },
    dayTimer,
  };
}

/** A rep logged by hand for work done elsewhere. `onClock: false` because the
 *  day clock never saw it — see budgetProgress for why that distinction is the
 *  difference between counting a session once and counting it twice. */
function loggedAttempt(solveMin, date = todayISO()) {
  return { id: "a1", date, outcome: "solved-clean", patternGuess: "correct",
    timeToInsightMin: 5, timeToSolveMin: solveMin, mistakeTags: [],
    soulStatement: "", onClock: false };
}

/** A session done in the app while the day clock was running, so the clock has
 *  already counted these minutes. */
function clockedAttempt(solveMin, date = todayISO()) {
  return { ...loggedAttempt(solveMin, date), id: "a2", onClock: true };
}

describe("day timer", () => {
  test("test_dayTimerElapsed_freshTimer_isZero", () => {
    assert.equal(dayTimerElapsedMs(makeState({ dayTimer: newDayTimer() })), 0);
  });

  test("test_dayTimerElapsed_noTimerAtAll_isZeroNotNaN", () => {
    assert.equal(dayTimerElapsedMs(makeState()), 0);
  });

  test("test_dayTimerElapsed_whileRunning_countsTheOpenStretch", () => {
    const state = makeState({ dayTimer: newDayTimer() });
    startDayTimer(state, 1000);
    assert.equal(dayTimerElapsedMs(state, 1000 + 5 * MIN), 5 * MIN);
  });

  test("test_stopDayTimer_banksTheStretchAndStopsCounting", () => {
    const state = makeState({ dayTimer: newDayTimer() });
    startDayTimer(state, 0);
    stopDayTimer(state, 10 * MIN);
    // Time passing after a stop must not accumulate.
    assert.equal(dayTimerElapsedMs(state, 90 * MIN), 10 * MIN);
  });

  test("test_dayTimer_startStopStart_addsTheStretchesTogether", () => {
    const state = makeState({ dayTimer: newDayTimer() });
    startDayTimer(state, 0);
    stopDayTimer(state, 10 * MIN);
    startDayTimer(state, 30 * MIN);
    assert.equal(dayTimerElapsedMs(state, 35 * MIN), 15 * MIN);
  });

  test("test_startDayTimer_calledTwice_doesNotRestartTheClock", () => {
    // A double-click on Start would otherwise throw away the elapsed stretch
    // by resetting startedAt.
    const state = makeState({ dayTimer: newDayTimer() });
    startDayTimer(state, 0);
    startDayTimer(state, 5 * MIN);
    assert.equal(dayTimerElapsedMs(state, 10 * MIN), 10 * MIN);
  });

  test("test_stopDayTimer_whenNotRunning_isANoOp", () => {
    const state = makeState({ dayTimer: newDayTimer() });
    startDayTimer(state, 0);
    stopDayTimer(state, 10 * MIN);
    stopDayTimer(state, 50 * MIN);
    assert.equal(dayTimerElapsedMs(state, 60 * MIN), 10 * MIN);
  });

  test("test_dayTimerElapsed_timerLeftRunningFromYesterday_readsZeroToday", () => {
    // The failure this prevents: leaving the clock running overnight and
    // opening the app to be told you have already blown today's budget.
    const stale = { ...newDayTimer(addDaysISO(todayISO(), -1)), running: true, startedAt: 0 };
    assert.equal(dayTimerElapsedMs(makeState({ dayTimer: stale }), 20 * 60 * MIN), 0);
  });

  test("test_startDayTimer_afterMidnight_startsAFreshDayAtZero", () => {
    const stale = { ...newDayTimer(addDaysISO(todayISO(), -1)), accumulatedMs: 99 * MIN };
    const state = makeState({ dayTimer: stale });
    startDayTimer(state, 0);
    assert.equal(state.dayTimer.date, todayISO());
    assert.equal(dayTimerElapsedMs(state, 5 * MIN), 5 * MIN);
  });

  test("test_resetDayTimer_clearsEverything", () => {
    const state = makeState({ dayTimer: newDayTimer() });
    startDayTimer(state, 0);
    resetDayTimer(state);
    assert.equal(dayTimerElapsedMs(state, 60 * MIN), 0);
  });
});

describe("budgetProgress", () => {
  test("test_budgetProgress_freshDay_reportsTheWholeBudgetRemaining", () => {
    const p = budgetProgress(makeState({ budget: 75 }));
    assert.equal(p.usedMin, 0);
    assert.equal(p.remainingMin, 75);
    assert.equal(p.over, false);
  });

  test("test_budgetProgress_countsWorkDoneElsewhereOnTopOfTheClock", () => {
    // A rep done on paper and a clock running at the desk are different
    // minutes, so they add.
    const state = makeState({ budget: 75, attempts: [loggedAttempt(30)], dayTimer: newDayTimer() });
    startDayTimer(state, 0);
    const p = budgetProgress(state, 20 * MIN);
    assert.equal(p.loggedMin, 30);
    assert.equal(p.clockMin, 20);
    assert.equal(p.usedMin, 50);
    assert.equal(p.remainingMin, 25);
  });

  test("test_budgetProgress_doesNotCountAClockedSessionTwice", () => {
    // This test previously asserted the opposite, with the comment "both are
    // practice; counting only one would under-report the day" — true of a paper
    // rep and false of a session the clock was already watching. It was the bug
    // written down: saving a 45-minute problem moved the day from 30 minutes
    // left to 15 minutes over, with no time having passed.
    const state = makeState({ budget: 75, attempts: [clockedAttempt(20)], dayTimer: newDayTimer() });
    startDayTimer(state, 0);
    const p = budgetProgress(state, 20 * MIN);
    assert.equal(p.loggedMin, 0, "the session's minutes are the clock's minutes");
    assert.equal(p.usedMin, 20);
    assert.equal(p.remainingMin, 55);
  });

  test("test_budgetProgress_ignoresAttemptsFromOtherDays", () => {
    const state = makeState({ budget: 75, attempts: [loggedAttempt(40, addDaysISO(todayISO(), -1))] });
    assert.equal(budgetProgress(state).usedMin, 0);
  });

  test("test_budgetProgress_pastTheBudget_reportsOverAndClampsRemainingAtZero", () => {
    const state = makeState({ budget: 60, attempts: [loggedAttempt(90)] });
    const p = budgetProgress(state);
    assert.equal(p.over, true);
    assert.equal(p.overMin, 30);
    assert.equal(p.remainingMin, 0, "remaining must never go negative");
  });

  test("test_budgetProgress_overrunOnlyOncePastTheSameThresholdThePlantUses", () => {
    const under = makeState({ budget: 60, attempts: [loggedAttempt(60 * OVERRUN_MULTIPLE - 1)] });
    const over = makeState({ budget: 60, attempts: [loggedAttempt(60 * OVERRUN_MULTIPLE + 1)] });
    assert.equal(budgetProgress(under).overrun, false);
    assert.equal(budgetProgress(over).overrun, true);
  });

  test("test_budgetProgress_zeroBudget_doesNotDivideByZero", () => {
    const p = budgetProgress(makeState({ budget: 0 }));
    assert.ok(Number.isFinite(p.fraction));
  });
});

describe("budgetPressure", () => {
  test("test_budgetPressure_emptyDay_isZero", () => {
    assert.equal(budgetPressure(makeState({ budget: 60 })), 0);
  });

  test("test_budgetPressure_growsTowardsOneAsTheBudgetFills", () => {
    const half = budgetPressure(makeState({ budget: 60, attempts: [loggedAttempt(30)] }));
    const most = budgetPressure(makeState({ budget: 60, attempts: [loggedAttempt(54)] }));
    assert.ok(Math.abs(half - 0.5) < 1e-9);
    assert.ok(most > half && most <= 1);
  });

  test("test_budgetPressure_exactlyAtBudget_peaksAtOne", () => {
    assert.equal(budgetPressure(makeState({ budget: 60, attempts: [loggedAttempt(60)] })), 1);
  });

  test("test_budgetPressure_pastTheBudget_fallsBackThroughZero", () => {
    // The whole point of the shrinking plant: going over has to visibly cost
    // something, not just stop earning.
    const over = budgetPressure(makeState({ budget: 60, attempts: [loggedAttempt(90)] }));
    assert.ok(over < 1, "pressure must fall once past the budget");
    assert.ok(over < budgetPressure(makeState({ budget: 60, attempts: [loggedAttempt(70)] })));
  });

  test("test_budgetPressure_farPastTheBudget_bottomsOutAtMinusOne", () => {
    const wild = budgetPressure(makeState({ budget: 60, attempts: [loggedAttempt(600)] }));
    assert.equal(wild, -1, "a runaway day must clamp, not scale without limit");
  });
});
