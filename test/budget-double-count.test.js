// The day budget counts each minute once (js/logic.js).
//
// Reported from real use: "when I submitted my soul statement, my time dropped
// from 30 minutes to +15 minutes". Nothing happened in between except saving.
//
// The cause: budgetProgress added the day clock's minutes to the minutes logged
// against today's attempts, on the reasoning that a day where you logged two
// problems and then ran the clock for twenty minutes has used both. True, and
// it quietly assumed the two are never the same minutes — which they are
// whenever the clock runs during a session you then save, i.e. the ordinary way
// to use the app. A 45-minute problem was charged twice the instant it landed.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { budgetProgress, todayISO, addDaysISO } from "../js/logic.js";

const MIN = 60_000;
const NOW = 1_800_000_000_000;

const attempt = (over = {}) => ({
  id: "a1", date: todayISO(), outcome: "solved-clean", patternGuess: "correct",
  timeToInsightMin: 5, timeToSolveMin: 45, mistakeTags: [], soulStatement: "a note", ...over,
});

const state = ({ attempts = [], clockMin = 0, running = true, budget = 75 } = {}) => ({
  settings: { dailyBudgetMin: budget },
  dayTimer: {
    date: todayISO(), running,
    startedAt: running ? NOW - clockMin * MIN : null,
    accumulatedMs: running ? 0 : clockMin * MIN,
    adjustmentMs: 0,
  },
  problems: [{
    id: "p1", name: "P", number: 1, difficulty: "Medium", patternId: "x",
    status: "active", box: 1, nextReviewDate: todayISO(), attempts,
  }],
});

describe("the reported bug", () => {
  test("test_budget_savingAClockedSessionDoesNotChangeTheNumber", () => {
    // The exact report: 45 minutes into a 75-minute budget, 30 left. Saving the
    // reflection must not move it, because no time passed.
    const before = budgetProgress(state({ clockMin: 45 }), NOW);
    const after = budgetProgress(state({ clockMin: 45, attempts: [attempt({ onClock: true })] }), NOW);
    assert.equal(Math.round(before.remainingMin), 30);
    assert.equal(Math.round(after.remainingMin), 30);
    assert.equal(after.over, false, "saving the session pushed the day over budget on its own");
  });

  test("test_budget_theSameMinutesAreNeverCountedTwice", () => {
    const p = budgetProgress(state({ clockMin: 45, attempts: [attempt({ onClock: true })] }), NOW);
    assert.equal(Math.round(p.usedMin), 45, `45 minutes of work reported as ${p.usedMin}`);
  });
});

describe("what still counts", () => {
  test("test_budget_aRepLoggedFromPaperCountsInFull", () => {
    // Never on the clock, so it is additional practice and the budget should
    // say so. It records `onClock: false` outright — an unmarked attempt is
    // the ambiguous case, and the manual log path does not leave it ambiguous.
    const p = budgetProgress(state({
      clockMin: 20, attempts: [attempt({ onClock: false, timeToSolveMin: 30 })],
    }), NOW);
    assert.equal(Math.round(p.usedMin), 50);
  });

  test("test_budget_anOlderAttemptWithNoFlagCountsWhenNoClockRan", () => {
    // Every attempt recorded before this fix has no flag. With no clock today
    // there is nothing it could have been double-counted against, so it counts.
    const p = budgetProgress(state({ clockMin: 0, running: false, attempts: [attempt()] }), NOW);
    assert.equal(Math.round(p.usedMin), 45);
  });

  test("test_budget_theClockCountsWhileASessionIsStillOpen", () => {
    // Before anything is saved there is no attempt, so the clock is the only
    // evidence the day has been used at all.
    const p = budgetProgress(state({ clockMin: 25 }), NOW);
    assert.equal(Math.round(p.usedMin), 25);
  });

  test("test_budget_aClockedSessionPlusAPaperRepCountBoth", () => {
    const p = budgetProgress(state({
      clockMin: 45,
      attempts: [attempt({ onClock: true }), attempt({ id: "a2", onClock: false, timeToSolveMin: 20 })],
    }), NOW);
    assert.equal(Math.round(p.usedMin), 65);
  });

  test("test_budget_yesterdaysAttemptsAreNotTodaysBudget", () => {
    const p = budgetProgress(state({
      clockMin: 10, attempts: [attempt({ date: addDaysISO(todayISO(), -1), timeToSolveMin: 90 })],
    }), NOW);
    assert.equal(Math.round(p.usedMin), 10);
  });
});

describe("the flag is set from what was actually true", () => {
  const src = readFileSync(new URL("../js/session-view.js", import.meta.url), "utf8");

  test("test_budget_onlySetWhenTheClockWasRunningToday", () => {
    // Not "a session happened", which would exclude the minutes of anyone who
    // never uses the day clock and make their budget read as empty all day.
    assert.match(src, /onClock: !!\(s\.dayTimer\?\.running && s\.dayTimer\.date === date\)/);
  });
});

describe("the attempt that was already saved before the fix existed", () => {
  // The first fix only marked *new* sessions, so the attempt already in
  // today's log kept double-counting and the day stayed wrong until midnight —
  // which is exactly what "it's still showing +15 minutes past budget" meant.
  //
  // There is no way to know after the fact whether the clock was running
  // through an unmarked attempt. When the clock has meaningfully run today,
  // it is assumed to have been, because the session workspace was the only
  // thing creating attempts and it is the case that broke.

  test("test_budget_anUnmarkedAttemptFromTodayIsAssumedToHaveBeenOnTheClock", () => {
    const p = budgetProgress(state({ clockMin: 45, attempts: [attempt()] }), NOW);
    assert.equal(Math.round(p.remainingMin), 30);
    assert.equal(p.over, false);
  });

  test("test_budget_withNoClockTodayAnUnmarkedAttemptStillCountsInFull", () => {
    // The assumption must not eat the minutes of someone who never starts the
    // day clock — their budget would read empty all day.
    const p = budgetProgress(state({ clockMin: 0, running: false, attempts: [attempt()] }), NOW);
    assert.equal(Math.round(p.usedMin), 45);
  });

  test("test_budget_aClockStartedSecondsAgoDoesNotSwallowASession", () => {
    // A bare `clockMin > 0` made a clock started two milliseconds ago absorb a
    // 45-minute rep, reporting a day of work as zero.
    const p = budgetProgress(state({ clockMin: 0.01, attempts: [attempt()] }), NOW);
    assert.equal(Math.round(p.usedMin), 45);
  });

  test("test_budget_anExplicitFalseIsNeverAssumedAway", () => {
    // A manually logged rep says so outright, so the assumption cannot reach
    // it however long the clock has run.
    const p = budgetProgress(state({
      clockMin: 45, attempts: [attempt({ onClock: false, timeToSolveMin: 20 })],
    }), NOW);
    assert.equal(Math.round(p.usedMin), 65);
  });

  test("test_budget_theManualLogPathSaysSoOutright", () => {
    const views = readFileSync(new URL("../js/views.js", import.meta.url), "utf8");
    assert.match(views, /onClock: false/);
  });
});
