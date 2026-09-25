// Correcting today's clock (js/logic.js).
//
// The clock feeds the budget ring and the plant's health, and it could only
// run or pause. Leave it going over lunch and the day was spent, with no way
// to say otherwise — and a number you cannot correct is a number you stop
// trusting, and then stop looking at, which costs more than the wrong forty
// minutes did.
//
// The correction is stored apart from the reading on purpose. The clock keeps
// exactly what it measured and the correction stays visible as a correction; a
// single merged number would quietly become the thing you remember editing and
// stop being either.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  newDayTimer, adjustDayTimer, dayTimerAdjustmentMin, dayTimerElapsedMs,
  startDayTimer, stopDayTimer, todayISO, addDaysISO,
} from "../js/logic.js";

const MIN = 60000;
/** A state whose clock has banked `min` minutes today and is not running. */
const withClock = (min, over = {}) => ({
  dayTimer: { ...newDayTimer(), accumulatedMs: min * MIN, ...over },
  settings: { dailyBudgetMin: 75 },
  problems: [],
});

describe("adjusting", () => {
  test("test_adjust_subtracting_reducesTheReading", () => {
    const s = withClock(90);
    adjustDayTimer(s, -45);
    assert.equal(dayTimerElapsedMs(s) / MIN, 45);
  });

  test("test_adjust_adding_increasesTheReading", () => {
    // Forgetting to start it is as common as forgetting to stop it.
    const s = withClock(10);
    adjustDayTimer(s, 20);
    assert.equal(dayTimerElapsedMs(s) / MIN, 30);
  });

  test("test_adjust_leavesTheMeasuredReadingAlone", () => {
    // What the clock actually counted is evidence, and stays.
    const s = withClock(90);
    adjustDayTimer(s, -45);
    assert.equal(s.dayTimer.accumulatedMs / MIN, 90);
    assert.equal(s.dayTimer.adjustmentMs / MIN, -45);
  });

  test("test_adjust_correctionIsReportableSeparately", () => {
    const s = withClock(90);
    adjustDayTimer(s, -45);
    assert.equal(dayTimerAdjustmentMin(s), -45);
  });

  test("test_adjust_accumulates", () => {
    const s = withClock(90);
    adjustDayTimer(s, -15);
    adjustDayTimer(s, -15);
    assert.equal(dayTimerAdjustmentMin(s), -30);
    assert.equal(dayTimerElapsedMs(s) / MIN, 60);
  });
});

describe("what it refuses to do", () => {
  test("test_adjust_cannotDriveTheDayBelowZero", () => {
    // "None of this was practice" is zero, not a debt carried into tomorrow.
    const s = withClock(20);
    adjustDayTimer(s, -60);
    assert.equal(dayTimerElapsedMs(s) / MIN, 0);
  });

  test("test_adjust_returnsWhatWasActuallyApplied", () => {
    // The UI says what happened, not what was asked: taking half an hour off a
    // ten-minute day removes ten minutes.
    const s = withClock(10);
    assert.equal(adjustDayTimer(s, -30), -10);
  });

  test("test_adjust_returnsTheFullAmountWhenThereIsRoom", () => {
    assert.equal(adjustDayTimer(withClock(60), -30), -30);
  });

  test("test_adjust_twoSuccessiveCorrections_cannotGoNegativeBetweenThem", () => {
    // Clamping against the adjustment rather than the total would allow this.
    const s = withClock(30);
    adjustDayTimer(s, -30);
    adjustDayTimer(s, -30);
    assert.equal(dayTimerElapsedMs(s) / MIN, 0);
    assert.equal(dayTimerAdjustmentMin(s), -30);
  });
});

describe("alongside the running clock", () => {
  test("test_adjust_whileRunning_appliesToTheLiveReading", () => {
    const s = withClock(0);
    const t0 = 1_000_000;
    startDayTimer(s, t0);
    adjustDayTimer(s, 10, t0);
    assert.equal(dayTimerElapsedMs(s, t0 + 5 * MIN) / MIN, 15);
  });

  test("test_adjust_survivesStoppingTheClock", () => {
    const s = withClock(0);
    const t0 = 1_000_000;
    startDayTimer(s, t0);
    adjustDayTimer(s, -5, t0 + 10 * MIN);   // ten minutes in, five of them weren't work
    stopDayTimer(s, t0 + 20 * MIN);
    assert.equal(dayTimerElapsedMs(s, t0 + 20 * MIN) / MIN, 15);
  });

  test("test_adjust_cannotSubtractTimeThatHasNotElapsedYet", () => {
    // Asking to take five minutes off a clock that has just started is asking
    // to correct the future. It clamps to nothing rather than banking a credit
    // against the rest of the day.
    const s = withClock(0);
    const t0 = 1_000_000;
    startDayTimer(s, t0);
    assert.equal(adjustDayTimer(s, -5, t0), 0);
    assert.equal(dayTimerElapsedMs(s, t0 + 20 * MIN) / MIN, 20);
  });
});

describe("day boundaries", () => {
  test("test_adjust_yesterdaysTimer_startsTodayFresh", () => {
    // Rolling over is the same rule startDayTimer already follows.
    const s = withClock(90, { date: addDaysISO(todayISO(), -1) });
    adjustDayTimer(s, -10);
    assert.equal(s.dayTimer.date, todayISO());
    assert.equal(dayTimerElapsedMs(s) / MIN, 0, "yesterday's 90 minutes are not today's");
  });

  test("test_adjustmentMin_yesterdaysCorrection_isNotReportedAsTodays", () => {
    const s = withClock(0, { date: addDaysISO(todayISO(), -1), adjustmentMs: -30 * MIN });
    assert.equal(dayTimerAdjustmentMin(s), 0);
  });

  test("test_adjust_noTimerAtAll_doesNotThrow", () => {
    const s = { settings: { dailyBudgetMin: 75 }, problems: [] };
    assert.doesNotThrow(() => adjustDayTimer(s, 10));
  });
});

describe("a timer stored before corrections existed", () => {
  test("test_elapsed_timerWithNoAdjustmentField_readsAsUncorrected", () => {
    // No migration: absent means zero, which is what it meant.
    const legacy = { dayTimer: { date: todayISO(), running: false, startedAt: null, accumulatedMs: 45 * MIN } };
    assert.equal(dayTimerElapsedMs(legacy) / MIN, 45);
    assert.equal(dayTimerAdjustmentMin(legacy), 0);
  });

  test("test_adjust_legacyTimer_canStillBeCorrected", () => {
    const legacy = { dayTimer: { date: todayISO(), running: false, startedAt: null, accumulatedMs: 45 * MIN } };
    adjustDayTimer(legacy, -15);
    assert.equal(dayTimerElapsedMs(legacy) / MIN, 30);
  });
});
