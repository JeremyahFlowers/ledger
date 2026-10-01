// Focus and variety in the recommendation (js/logic.js).
//
// Reported from real use: "Up next" said 3Sum every day, and it took no notice
// of what was being worked on — "Let's say I am working on DP, but I have two
// pointers down really well. Why suggest 3Sum / Container With Most Water?"
//
// The pick is now a weighted draw seeded by the day. These tests pin what the
// weights promise rather than the exact problem any one seed lands on.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  uid, recommendSession, todayISO, addDaysISO, STATUS_ACTIVE, STATUS_BACKLOG,
  currentFocus, setFocus, isMastered, seededRandom, weightedPick,
  MASTERED_MIN_ATTEMPTS, MASTERED_CLEAN_RATE,
} from "../js/logic.js";

const PATTERNS = [
  { id: "two-pointers", name: "Two Pointers", description: "" },
  { id: "dp", name: "Dynamic Programming", description: "" },
  { id: "graphs", name: "Graphs", description: "" },
];

const attempt = (over = {}) => ({
  id: uid(), date: todayISO(), outcome: "solved-clean", patternGuess: "correct",
  timeToInsightMin: 5, timeToSolveMin: 20, mistakeTags: [], soulStatement: "", ...over,
});

const problem = (over = {}) => ({
  id: over.id || uid(), name: over.id || "P", number: 1, difficulty: "Medium",
  patternId: "two-pointers", status: STATUS_ACTIVE, box: 0,
  nextReviewDate: todayISO(), attempts: [], ...over,
});

/** A state with some two-pointers problems, some DP and some graphs all due,
 *  plus whatever history the test adds. */
function makeSubject({ extra = [], prep = {}, perPattern = 4 } = {}) {
  const problems = [];
  for (const patternId of ["two-pointers", "dp", "graphs"]) {
    for (let i = 0; i < perPattern; i++) problems.push(problem({ id: `${patternId}-${i}`, patternId }));
  }
  return {
    settings: {
      dailyBudgetMin: 75, boxIntervalsDays: [0, 1, 3, 7, 16, 35],
      estimateMinByDifficulty: { Easy: 20, Medium: 30, Hard: 45, Unrated: 30 },
      prep,
    },
    patterns: PATTERNS,
    problems: [...problems, ...extra],
    mocks: [], streak: { current: 0, longest: 0, lastActiveDate: null },
  };
}

/** A pattern with a long clean record, off the due list, so it counts as mastered. */
function masteredHistory(patternId, n = 6) {
  return problem({
    id: `${patternId}-history`, patternId, box: 4, nextReviewDate: addDaysISO(todayISO(), 30),
    attempts: Array.from({ length: n }, (_, i) => attempt({ date: addDaysISO(todayISO(), -40 - i) })),
  });
}

/** How often each pattern comes up across many seeds. */
function tally(state, seeds = 400) {
  const counts = {};
  for (let i = 0; i < seeds; i++) {
    const rec = recommendSession(state, "mixed", { seed: `s${i}` });
    counts[rec.patternId] = (counts[rec.patternId] || 0) + 1;
  }
  return counts;
}

describe("the draw", () => {
  test("test_seededRandom_sameSeed_sameSequence", () => {
    const a = seededRandom("2026-09-29");
    const b = seededRandom("2026-09-29");
    assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  });

  test("test_seededRandom_differentSeeds_differ", () => {
    assert.notEqual(seededRandom("a")(), seededRandom("b")());
  });

  test("test_seededRandom_staysInTheUnitInterval", () => {
    const r = seededRandom("x");
    for (let i = 0; i < 1000; i++) {
      const v = r();
      assert.ok(v >= 0 && v < 1, `${v}`);
    }
  });

  test("test_weightedPick_empty_isNull", () => {
    assert.equal(weightedPick([], () => 1, seededRandom("x")), null);
  });

  test("test_weightedPick_zeroWeight_isNeverPicked", () => {
    const r = seededRandom("x");
    for (let i = 0; i < 200; i++) assert.equal(weightedPick(["a", "b"], (x) => (x === "a" ? 0 : 1), r), "b");
  });

  test("test_weightedPick_allZero_stillPicksSomething", () => {
    assert.ok(["a", "b"].includes(weightedPick(["a", "b"], () => 0, seededRandom("x"))));
  });
});

describe("variety", () => {
  test("test_recommendSession_sameSeed_sameProblem", () => {
    // A recommendation that changed on every render would be noise.
    const state = makeSubject();
    const a = recommendSession(state, "mixed", { seed: "day" });
    const b = recommendSession(state, "mixed", { seed: "day" });
    assert.equal(a.problem.id, b.problem.id);
  });

  test("test_recommendSession_acrossDays_isNotAlwaysTheHeadOfTheQueue", () => {
    const state = makeSubject();
    const picked = new Set();
    for (let i = 0; i < 30; i++) picked.add(recommendSession(state, "mixed", { seed: `day${i}` }).problem.id);
    assert.ok(picked.size >= 5, `only ${picked.size} different problems in 30 days`);
  });

  test("test_recommendSession_withoutASeed_usesTodayAndIsStable", () => {
    const state = makeSubject();
    assert.equal(recommendSession(state).problem.id, recommendSession(state).problem.id);
  });
});

describe("what you are working on", () => {
  test("test_currentFocus_chosen_winsOverRecentWork", () => {
    const state = makeSubject({ prep: { focusPatternId: "graphs" } });
    state.problems[0].attempts.push(attempt(), attempt());           // two-pointers, recently
    assert.deepEqual(currentFocus(state), { patternId: "graphs", source: "chosen" });
  });

  test("test_currentFocus_chosenPatternThatNoLongerExists_isIgnored", () => {
    const state = makeSubject({ prep: { focusPatternId: "gone" } });
    assert.equal(currentFocus(state), null);
  });

  test("test_currentFocus_twoOfTheLastFewOnOnePattern_isInferred", () => {
    const state = makeSubject();
    state.problems.find((p) => p.id === "dp-0").attempts.push(attempt({ outcome: "failed" }));
    state.problems.find((p) => p.id === "dp-1").attempts.push(attempt({ outcome: "solved-struggled" }));
    assert.deepEqual(currentFocus(state), { patternId: "dp", source: "recent" });
  });

  test("test_currentFocus_oneAttempt_isNotAFocus", () => {
    const state = makeSubject();
    state.problems.find((p) => p.id === "dp-0").attempts.push(attempt());
    assert.equal(currentFocus(state), null);
  });

  test("test_currentFocus_workOlderThanAWeek_isNotAFocus", () => {
    const state = makeSubject();
    const old = addDaysISO(todayISO(), -10);
    state.problems.find((p) => p.id === "dp-0").attempts.push(attempt({ date: old }), attempt({ date: old }));
    assert.equal(currentFocus(state), null);
  });

  test("test_currentFocus_recentWorkOnAMasteredPattern_isNotInferred", () => {
    // Reviewing two pointers twice this week does not make it the thing being
    // learned.
    const state = makeSubject({ extra: [masteredHistory("two-pointers")] });
    state.problems[0].attempts.push(attempt(), attempt());
    assert.equal(currentFocus(state), null);
  });

  test("test_setFocus_thenClear_roundTrips", () => {
    const state = makeSubject();
    setFocus(state, "dp");
    assert.equal(currentFocus(state).patternId, "dp");
    setFocus(state, null);
    assert.equal(state.settings.prep.focusPatternId, null);
  });

  test("test_setFocus_keepsTheRestOfThePrepProfile", () => {
    const state = makeSubject({ prep: { target: "top", language: "python" } });
    setFocus(state, "dp");
    assert.equal(state.settings.prep.language, "python");
  });

  test("test_recommendSession_focusOnDp_mostlySuggestsDp", () => {
    const counts = tally(makeSubject({ prep: { focusPatternId: "dp" } }));
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    assert.ok(counts.dp / total > 0.6, `DP came up ${counts.dp} of ${total}`);
  });

  test("test_recommendSession_focusedPick_saysSo", () => {
    const state = makeSubject({ prep: { focusPatternId: "dp" } });
    for (let i = 0; i < 20; i++) {
      const rec = recommendSession(state, "mixed", { seed: `f${i}` });
      if (rec.patternId === "dp") { assert.equal(rec.focus.patternId, "dp"); return; }
    }
    assert.fail("never picked the focus");
  });

  test("test_recommendSession_masteredPattern_rarelyComesUp", () => {
    const state = makeSubject({ extra: [masteredHistory("two-pointers")] });
    const counts = tally(state);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    assert.ok((counts["two-pointers"] || 0) / total < 0.15,
      `a mastered pattern came up ${counts["two-pointers"]} of ${total}`);
  });

  test("test_recommendSession_masteredPattern_stillComesUpSometimes", () => {
    // Rarely, not never: it is spaced review, and review still has to happen.
    const counts = tally(makeSubject({ extra: [masteredHistory("two-pointers")] }), 800);
    assert.ok((counts["two-pointers"] || 0) > 0);
  });

  test("test_recommendSession_foundationsWithAChosenFocus_blocksOnIt", () => {
    const state = makeSubject({ prep: { focusPatternId: "graphs" } });
    state.problems[0].attempts.push(attempt({ date: addDaysISO(todayISO(), -1) }));
    const rec = recommendSession(state, "foundations", { seed: "x" });
    assert.equal(rec.type, "block");
    assert.equal(rec.patternId, "graphs");
  });

  test("test_recommendSession_chosenFocus_weakOtherPattern_doesNotPullYouOffIt", () => {
    // Two pointers going badly today is not a reason to leave DP when DP is
    // what you chose to work on.
    const state = makeSubject({ prep: { focusPatternId: "dp" } });
    const tp = state.problems.find((p) => p.id === "two-pointers-0");
    tp.attempts.push(attempt({ outcome: "failed" }), attempt({ outcome: "failed" }));
    for (let i = 0; i < 20; i++) {
      const rec = recommendSession(state, "mixed", { seed: `w${i}` });
      assert.ok(!(rec.type === "deep-dive" && rec.patternId === "two-pointers"), `seed w${i} deep-dived elsewhere`);
    }
  });

  test("test_recommendSession_chosenFocusWeak_deepDivesOnIt", () => {
    const state = makeSubject({ prep: { focusPatternId: "dp" } });
    const dp = state.problems.find((p) => p.id === "dp-0");
    dp.attempts.push(attempt({ outcome: "failed" }), attempt({ outcome: "failed" }));
    const rec = recommendSession(state, "mixed", { seed: "x" });
    assert.equal(rec.type, "deep-dive");
    assert.equal(rec.patternId, "dp");
  });

  test("test_recommendSession_emptyQueue_newProblemComesFromTheFocus", () => {
    const bank = ["two-pointers", "dp", "graphs"].map((patternId) =>
      problem({ id: `bank-${patternId}`, patternId, status: STATUS_BACKLOG, nextReviewDate: null }));
    const state = makeSubject({ perPattern: 0, extra: bank, prep: { focusPatternId: "dp" } });
    const rec = recommendSession(state, "mixed", { seed: "x" });
    assert.equal(rec.type, "fresh-volume");
    assert.equal(rec.problem.id, "bank-dp");
  });
});

describe("mastery", () => {
  test("test_isMastered_atTheThreshold_isMastered", () => {
    assert.equal(isMastered({ attempts: MASTERED_MIN_ATTEMPTS, solvedCleanRate: MASTERED_CLEAN_RATE }), true);
  });

  test("test_isMastered_tooFewAttempts_isNot", () => {
    assert.equal(isMastered({ attempts: MASTERED_MIN_ATTEMPTS - 1, solvedCleanRate: 1 }), false);
  });

  test("test_isMastered_noRecord_isNot", () => {
    assert.equal(isMastered(undefined), false);
    assert.equal(isMastered({ attempts: 5, solvedCleanRate: null }), false);
  });
});
