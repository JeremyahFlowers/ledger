// Tests for weighted quiz selection (js/logic.js).
//
// The quiz picked uniformly at random from everything ever attempted, inside
// an app built entirely on a spacing algorithm: the one page purely about
// recall was the one not using it.
//
// Weighted, not "take the highest" — always asking the single most overdue
// problem would make the quiz a queue with extra steps, and the point of a
// drill is that the next question isn't predictable. So these check the
// ordering of priorities and that sampling respects them, rather than
// asserting a specific problem comes back.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { quizPriority, pickQuizProblem, todayISO, addDaysISO, STATUS_ACTIVE } from "../js/logic.js";

let seq = 0;
const attempt = (daysAgo, patternGuess = "correct") => ({
  id: `a${seq++}`, date: addDaysISO(todayISO(), -daysAgo), outcome: "solved-clean",
  patternGuess, timeToInsightMin: 5, timeToSolveMin: 20, mistakeTags: [], soulStatement: "",
});

const problem = (over = {}) => ({
  id: `p${seq++}`, name: "P", number: 1, difficulty: "Medium", patternId: "two-pointers",
  status: STATUS_ACTIVE, box: 1, nextReviewDate: todayISO(), attempts: [attempt(1)], ...over,
});

describe("quizPriority", () => {
  test("test_priority_neverAttempted_isZero", () => {
    // There is nothing to recall about a problem you have not worked.
    assert.equal(quizPriority(problem({ attempts: [] })), 0);
  });

  test("test_priority_risesTheFurtherPastItsInterval", () => {
    const fresh = problem({ nextReviewDate: addDaysISO(todayISO(), 5) });
    const fading = problem({ nextReviewDate: addDaysISO(todayISO(), -20) });
    assert.ok(quizPriority(fading) > quizPriority(fresh));
  });

  test("test_priority_aMissedPatternOutranksOneYouGotRight", () => {
    const got = problem({ attempts: [attempt(3, "correct")] });
    const missed = problem({ attempts: [attempt(3, "incorrect")] });
    assert.ok(quizPriority(missed) > quizPriority(got),
      "a pattern you misidentified is worth asking again first");
  });

  test("test_priority_risesTheLongerSinceYouPractisedIt", () => {
    const recent = problem({ attempts: [attempt(1)] });
    const distant = problem({ attempts: [attempt(25)] });
    assert.ok(quizPriority(distant) > quizPriority(recent));
  });

  test("test_priority_restCreditIsCapped", () => {
    // Otherwise one problem abandoned two years ago drowns out everything.
    const old = problem({ attempts: [attempt(60)] });
    const ancient = problem({ attempts: [attempt(900)] });
    assert.equal(quizPriority(old), quizPriority(ancient));
  });

  test("test_priority_everythingAttemptedStaysReachable", () => {
    // A problem you are on top of should be rare, not impossible, or the quiz
    // stops being a quiz.
    const onTopOfIt = problem({ attempts: [attempt(0, "correct")], nextReviewDate: addDaysISO(todayISO(), 30) });
    assert.ok(quizPriority(onTopOfIt) > 0);
  });
});

describe("pickQuizProblem", () => {
  const state = (problems) => ({ problems });

  test("test_pick_nothingAttempted_isNull", () => {
    assert.equal(pickQuizProblem(state([problem({ attempts: [] })])), null);
  });

  test("test_pick_returnsSomethingAttempted", () => {
    const p = problem();
    assert.equal(pickQuizProblem(state([p]), [], () => 0.5).id, p.id);
  });

  test("test_pick_favoursTheFadingOne", () => {
    // Sampling the low end of the weight range must land on the higher-weight
    // problem, which is listed first.
    const fading = problem({ nextReviewDate: addDaysISO(todayISO(), -40), attempts: [attempt(40, "incorrect")] });
    const fresh = problem({ nextReviewDate: addDaysISO(todayISO(), 20), attempts: [attempt(0)] });
    assert.equal(pickQuizProblem(state([fading, fresh]), [], () => 0.01).id, fading.id);
  });

  test("test_pick_stillReachesTheLowWeightOne", () => {
    // Weighted, not deterministic: the quiz must not become a queue.
    const fading = problem({ nextReviewDate: addDaysISO(todayISO(), -40) });
    const fresh = problem({ nextReviewDate: addDaysISO(todayISO(), 20) });
    assert.equal(pickQuizProblem(state([fading, fresh]), [], () => 0.999).id, fresh.id);
  });

  test("test_pick_skipsWhatWasJustAsked", () => {
    const a = problem();
    const b = problem();
    assert.equal(pickQuizProblem(state([a, b]), [a.id], () => 0.5).id, b.id);
  });

  test("test_pick_onceEverythingHasBeenAsked_startsOver", () => {
    // The alternative is the quiz ending, which is not what anyone wants from
    // a drill.
    const a = problem();
    assert.equal(pickQuizProblem(state([a]), [a.id], () => 0.5).id, a.id);
  });

  test("test_pick_randomAtTheTopOfTheRange_staysInBounds", () => {
    const a = problem();
    const b = problem();
    assert.ok(pickQuizProblem(state([a, b]), [], () => 1) != null);
  });
});
