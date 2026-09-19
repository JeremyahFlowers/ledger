// Tests for the recency framing in js/logic.js.
//
// These pin a product decision as much as a calculation. The app deliberately
// does not tell anyone they are overdue: the schedule still knows when recall
// is fading, but what gets shown is how long since you last practiced, which
// is a fact about what you did rather than a debt you owe. The cases below
// exist so that framing can't quietly drift back into deadline language.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  lastPracticedISO, refresherStatus, recencyText, FADING_DAYS,
  todayISO, addDaysISO, STATUS_ACTIVE,
} from "../js/logic.js";

function problem({ attempts = [], nextReviewDate = todayISO() } = {}) {
  return {
    id: "p1", name: "P", number: 1, difficulty: "Medium", patternId: "two-pointers",
    status: STATUS_ACTIVE, box: 0, nextReviewDate, attempts,
  };
}

function attemptOn(daysAgo) {
  return {
    id: `a${daysAgo}`, date: addDaysISO(todayISO(), -daysAgo), outcome: "solved-clean",
    patternGuess: "correct", timeToInsightMin: 5, timeToSolveMin: 20,
    mistakeTags: [], soulStatement: "",
  };
}

describe("lastPracticedISO", () => {
  test("test_lastPracticed_neverAttempted_isNull", () => {
    assert.equal(lastPracticedISO(problem()), null);
  });

  test("test_lastPracticed_returnsTheMostRecentAttempt", () => {
    const p = problem({ attempts: [attemptOn(30), attemptOn(2), attemptOn(11)] });
    assert.equal(lastPracticedISO(p), addDaysISO(todayISO(), -2));
  });

  test("test_lastPracticed_unorderedAttempts_stillFindsTheLatest", () => {
    // Attempts are appended in order today, but nothing guarantees that for a
    // state file edited or merged by hand.
    const p = problem({ attempts: [attemptOn(1), attemptOn(40)] });
    assert.equal(lastPracticedISO(p), addDaysISO(todayISO(), -1));
  });

  test("test_lastPracticed_missingAttemptsArray_doesNotThrow", () => {
    assert.equal(lastPracticedISO({ name: "P" }), null);
  });
});

describe("refresherStatus", () => {
  test("test_refresherStatus_neverPractised_readsAsNewNotOverdue", () => {
    const s = refresherStatus(problem({ nextReviewDate: addDaysISO(todayISO(), -30) }));
    assert.equal(s.tone, "new");
    assert.equal(s.daysSince, null);
    assert.match(s.text, /not practiced yet/);
  });

  test("test_refresherStatus_practisedRecentlyAndNotYetScheduled_isFresh", () => {
    const s = refresherStatus(problem({
      attempts: [attemptOn(1)], nextReviewDate: addDaysISO(todayISO(), 5),
    }));
    assert.equal(s.tone, "fresh");
  });

  test("test_refresherStatus_atItsInterval_isReady", () => {
    const s = refresherStatus(problem({ attempts: [attemptOn(3)], nextReviewDate: todayISO() }));
    assert.equal(s.tone, "ready");
  });

  test("test_refresherStatus_wellPastItsInterval_isFading", () => {
    const s = refresherStatus(problem({
      attempts: [attemptOn(40)], nextReviewDate: addDaysISO(todayISO(), -FADING_DAYS),
    }));
    assert.equal(s.tone, "fading");
  });

  test("test_refresherStatus_reportsDaysSincePractice_notDaysPastSchedule", () => {
    // The distinction the whole change rests on: 20 days since you practised
    // it, not 13 days late.
    const s = refresherStatus(problem({
      attempts: [attemptOn(20)], nextReviewDate: addDaysISO(todayISO(), -13),
    }));
    assert.equal(s.daysSince, 20);
    assert.equal(s.pastInterval, 13);
    assert.match(s.text, /3 weeks ago/, "the gap since practice, not the 13 days past schedule");
  });

  test("test_refresherStatus_neverUsesDeadlineWords", () => {
    // Guards the product decision, not the arithmetic.
    const cases = [
      problem(),
      problem({ attempts: [attemptOn(1)], nextReviewDate: addDaysISO(todayISO(), 3) }),
      problem({ attempts: [attemptOn(9)], nextReviewDate: addDaysISO(todayISO(), -2) }),
      problem({ attempts: [attemptOn(90)], nextReviewDate: addDaysISO(todayISO(), -60) }),
    ];
    for (const p of cases) {
      const { text } = refresherStatus(p);
      assert.doesNotMatch(text, /overdue|due|late|behind|slipping/i,
        `"${text}" reintroduces deadline language`);
    }
  });
});

describe("recencyText", () => {
  test("test_recencyText_todayAndYesterday_readNaturally", () => {
    assert.equal(recencyText(0), "practiced today");
    assert.equal(recencyText(1), "practiced yesterday");
  });

  test("test_recencyText_withinAFortnight_countsDays", () => {
    assert.equal(recencyText(9), "9 days ago");
  });

  test("test_recencyText_pastAFortnight_switchesToWeeks", () => {
    assert.equal(recencyText(21), "3 weeks ago");
  });

  test("test_recencyText_pastTwoMonths_switchesToMonths", () => {
    // Precision past this point isn't information, and an exact day count that
    // far back reads as a tally being kept.
    assert.equal(recencyText(90), "3 months ago");
  });

  test("test_recencyText_weeksRunUpToTheMonthsBoundary", () => {
    // The weeks branch covers everything below 60 days, so months never has to
    // render a singular "1 month ago".
    assert.equal(recencyText(59), "8 weeks ago");
    assert.equal(recencyText(62), "2 months ago");
  });

  test("test_recencyText_null_saysNotPractisedRatherThanNaN", () => {
    assert.equal(recencyText(null), "not practiced yet");
  });
});
