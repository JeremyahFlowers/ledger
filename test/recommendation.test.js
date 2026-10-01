// Today's recommendation and "something else" (js/recommendation.js).
//
// Five screens ask for the recommendation; these pin that they get the same
// answer, that "something else" really does give something else, and that it
// wears off at midnight.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { todaysRecommendation, skipRecommendation } from "../js/recommendation.js";
import { todayISO, addDaysISO, STATUS_ACTIVE } from "../js/logic.js";

const TODAY = todayISO();

/** An in-memory localStorage, with a switch to make it throw like a blocked one. */
function makeStorage({ shouldThrow = false } = {}) {
  const data = new Map();
  return {
    data,
    getItem(k) { if (shouldThrow) throw new Error("blocked"); return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { if (shouldThrow) throw new Error("blocked"); data.set(k, String(v)); },
  };
}

function makeSubject({ count = 8 } = {}) {
  const problems = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, number: i, difficulty: "Medium",
    patternId: i % 2 ? "dp" : "graphs", status: STATUS_ACTIVE, box: 0,
    nextReviewDate: TODAY, attempts: [],
  }));
  return {
    settings: {
      dailyBudgetMin: 75, boxIntervalsDays: [0, 1, 3, 7, 16, 35],
      estimateMinByDifficulty: { Easy: 20, Medium: 30, Hard: 45, Unrated: 30 },
    },
    patterns: [{ id: "dp", name: "DP" }, { id: "graphs", name: "Graphs" }],
    problems, mocks: [], streak: { current: 0, longest: 0, lastActiveDate: null },
  };
}

describe("today's recommendation", () => {
  test("test_todaysRecommendation_askedTwice_isTheSameProblem", () => {
    const state = makeSubject();
    const storage = makeStorage();
    assert.equal(todaysRecommendation(state, storage, TODAY).problem.id,
      todaysRecommendation(state, storage, TODAY).problem.id);
  });

  test("test_todaysRecommendation_blockedStorage_stillRecommends", () => {
    const rec = todaysRecommendation(makeSubject(), makeStorage({ shouldThrow: true }), TODAY);
    assert.ok(rec.problem);
  });
});

describe("something else", () => {
  test("test_skipRecommendation_givesADifferentProblem", () => {
    const state = makeSubject();
    const storage = makeStorage();
    const before = todaysRecommendation(state, storage, TODAY);
    const after = skipRecommendation(state, storage, TODAY);
    assert.notEqual(after.problem.id, before.problem.id);
  });

  test("test_skipRecommendation_isWhatEveryScreenThenShows", () => {
    // Home shows it and `s` starts it: they must be the same problem.
    const state = makeSubject();
    const storage = makeStorage();
    const skipped = skipRecommendation(state, storage, TODAY);
    assert.equal(todaysRecommendation(state, storage, TODAY).problem.id, skipped.problem.id);
  });

  test("test_skipRecommendation_wearsOffTheNextDay", () => {
    const state = makeSubject();
    const storage = makeStorage();
    const tomorrow = addDaysISO(TODAY, 1);
    const fresh = todaysRecommendation(state, makeStorage(), tomorrow);
    skipRecommendation(state, storage, TODAY);
    assert.equal(todaysRecommendation(state, storage, tomorrow).problem.id, fresh.problem.id);
  });

  test("test_skipRecommendation_onlyOneCandidate_givesItBackRatherThanNothing", () => {
    const state = makeSubject({ count: 1 });
    const rec = skipRecommendation(state, makeStorage(), TODAY);
    assert.equal(rec.problem.id, "p0");
  });

  test("test_skipRecommendation_blockedStorage_doesNotThrow", () => {
    assert.doesNotThrow(() => skipRecommendation(makeSubject(), makeStorage({ shouldThrow: true }), TODAY));
  });

  test("test_todaysRecommendation_corruptStoredValue_isTodaysFirstPick", () => {
    const state = makeSubject();
    const storage = makeStorage();
    skipRecommendation(state, storage, TODAY);               // learn the key it writes
    for (const k of storage.data.keys()) storage.data.set(k, "{not json");
    assert.equal(todaysRecommendation(state, storage, TODAY).problem.id,
      todaysRecommendation(state, makeStorage(), TODAY).problem.id);
  });
});
