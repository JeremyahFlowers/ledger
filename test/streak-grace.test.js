// Tests for the streak's grace day (js/logic.js).
//
// The rest of this app spends its effort telling people to stop at their
// budget, that a lighter week is a good outcome, and that a volume spike is
// the shape that precedes quitting — and then reset a forty-day streak to 1
// for taking a single Sunday off. The loudest number on the dashboard
// contradicted everything around it.
//
// One missed day per rolling week is forgiven. Not unlimited: a streak that
// survives any gap measures nothing. And the missed day is recorded as a
// grace day rather than backfilled as practice, because the streak has to
// stay something the record can support.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { updateStreak, streakGraceInfo, todayISO, addDaysISO, STREAK_GRACE_DAYS_PER_WEEK } from "../js/logic.js";

const daysAgo = (n) => addDaysISO(todayISO(), -n);
const makeState = (streak) => ({ streak: { current: 0, longest: 0, lastActiveDate: null, ...streak } });

describe("updateStreak", () => {
  test("test_updateStreak_firstEverDay_startsAtOne", () => {
    const s = makeState({});
    updateStreak(s);
    assert.equal(s.streak.current, 1);
  });

  test("test_updateStreak_twiceInOneDay_doesNotDoubleCount", () => {
    const s = makeState({ current: 3, lastActiveDate: todayISO() });
    updateStreak(s);
    assert.equal(s.streak.current, 3);
  });

  test("test_updateStreak_consecutiveDays_increments", () => {
    const s = makeState({ current: 4, lastActiveDate: daysAgo(1) });
    updateStreak(s);
    assert.equal(s.streak.current, 5);
  });

  test("test_updateStreak_oneMissedDay_isForgiven", () => {
    // Practised Friday, took Saturday off, back on Sunday.
    const s = makeState({ current: 40, lastActiveDate: daysAgo(2) });
    updateStreak(s);
    assert.equal(s.streak.current, 41, "a single rest day must not reset a long streak");
    assert.equal(s.streak.graceDays.length, 1);
  });

  test("test_updateStreak_theForgivenDayIsRecordedNotBackfilledAsPractice", () => {
    // The streak survives, but the record must not claim you practised.
    const s = makeState({ current: 5, lastActiveDate: daysAgo(2) });
    updateStreak(s);
    assert.deepEqual(s.streak.graceDays, [daysAgo(1)]);
  });

  test("test_updateStreak_twoMissedDaysInARow_breaksTheStreak", () => {
    const s = makeState({ current: 40, lastActiveDate: daysAgo(3) });
    updateStreak(s);
    assert.equal(s.streak.current, 1, "the allowance is one day, not any gap");
  });

  test("test_updateStreak_secondGraceInTheSameWeek_breaksTheStreak", () => {
    // Already used this week's allowance two days ago.
    const s = makeState({ current: 10, lastActiveDate: daysAgo(2), graceDays: [daysAgo(2)] });
    updateStreak(s);
    assert.equal(s.streak.current, 1, "one per week, or the streak measures nothing");
  });

  test("test_updateStreak_graceRenewsOnceTheWeekHasPassed", () => {
    const s = makeState({ current: 20, lastActiveDate: daysAgo(2), graceDays: [daysAgo(30)] });
    updateStreak(s);
    assert.equal(s.streak.current, 21, "a grace day used last month should not count against today");
  });

  test("test_updateStreak_expiredGraceDaysAreForgotten", () => {
    // Otherwise the list grows forever inside a state file with a size limit.
    const s = makeState({ current: 3, lastActiveDate: daysAgo(1), graceDays: [daysAgo(90), daysAgo(60)] });
    updateStreak(s);
    assert.deepEqual(s.streak.graceDays, []);
  });

  test("test_updateStreak_brokenStreak_clearsTheAllowance", () => {
    const s = makeState({ current: 9, lastActiveDate: daysAgo(10), graceDays: [daysAgo(10)] });
    updateStreak(s);
    assert.deepEqual(s.streak.graceDays, []);
  });

  test("test_updateStreak_longestStillTracksThePeak", () => {
    const s = makeState({ current: 40, longest: 40, lastActiveDate: daysAgo(2) });
    updateStreak(s);
    assert.equal(s.streak.longest, 41);
  });

  test("test_updateStreak_stateWithoutGraceDays_doesNotThrow", () => {
    // Every state file written before this existed.
    const s = { streak: { current: 2, longest: 2, lastActiveDate: daysAgo(1) } };
    assert.doesNotThrow(() => updateStreak(s));
    assert.equal(s.streak.current, 3);
  });
});

describe("streakGraceInfo", () => {
  test("test_streakGraceInfo_unused_reportsTheFullAllowance", () => {
    const info = streakGraceInfo(makeState({}));
    assert.equal(info.used, 0);
    assert.equal(info.remaining, STREAK_GRACE_DAYS_PER_WEEK);
  });

  test("test_streakGraceInfo_spentThisWeek_isReported", () => {
    const info = streakGraceInfo(makeState({ graceDays: [daysAgo(1)] }));
    assert.equal(info.used, 1);
    assert.equal(info.remaining, 0);
  });

  test("test_streakGraceInfo_oldGraceDays_doNotCount", () => {
    assert.equal(streakGraceInfo(makeState({ graceDays: [daysAgo(20)] })).used, 0);
  });

  test("test_streakGraceInfo_missingStreak_doesNotThrow", () => {
    assert.doesNotThrow(() => streakGraceInfo({}));
  });
});
