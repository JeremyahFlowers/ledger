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
    // say so.
    const p = budgetProgress(state({ clockMin: 20, attempts: [attempt({ timeToSolveMin: 30 })] }), NOW);
    assert.equal(Math.round(p.usedMin), 50);
  });

  test("test_budget_anOlderAttemptWithNoFlagStillCounts", () => {
    // Every attempt recorded before this fix has no flag. Treating absent as
    // "not on the clock" keeps them counted, which is what they were.
    const p = budgetProgress(state({ clockMin: 0, attempts: [attempt()] }), NOW);
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
      attempts: [attempt({ onClock: true }), attempt({ id: "a2", timeToSolveMin: 20 })],
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
