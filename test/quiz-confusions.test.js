// Tests for quizConfusions (js/stats.js).
//
// The drill kept a lifetime score and revealed the right answer, then threw
// away the only part that could change what you study: which pattern you
// reached for instead. A score says recall is at 62%. It cannot say that four
// of the last six misses were Sliding Window answered as Two Pointers.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { quizConfusions, CONFUSION_MIN } from "../js/stats.js";

const answer = (actual, said) => ({ correct: actual === said, actual, said, problemId: "p" });
const st = (recent) => ({ quiz: { totalAsked: recent.length, totalCorrect: 0, recent } });
/** n answers where `said` was given for `actual`. */
const times = (n, actual, said) => Array.from({ length: n }, () => answer(actual, said));

describe("counting confusions", () => {
  test("test_confusions_pairSeenTwice_isReported", () => {
    const { pairs } = quizConfusions(st(times(2, "sliding-window", "two-pointers")));
    assert.deepEqual(pairs, [{ actual: "sliding-window", said: "two-pointers", times: 2 }]);
  });

  test("test_confusions_pairSeenOnce_isNotAConfusion", () => {
    // Once is a slip — a misread problem, a mis-click. Sending someone off to
    // study a mistake they made once is worse than saying nothing.
    assert.deepEqual(quizConfusions(st(times(1, "sliding-window", "two-pointers"))).pairs, []);
  });

  test("test_confusions_theMinimumIsWhatCONFUSION_MINSays", () => {
    assert.equal(quizConfusions(st(times(CONFUSION_MIN, "a", "b"))).pairs.length, 1);
    assert.equal(quizConfusions(st(times(CONFUSION_MIN - 1, "a", "b"))).pairs.length, 0);
  });

  test("test_confusions_correctAnswersAreNotConfusions", () => {
    assert.deepEqual(quizConfusions(st(times(5, "dp", "dp"))).pairs, []);
  });

  test("test_confusions_directionMatters", () => {
    // Calling Sliding Window "Two Pointers" is a different mistake from
    // calling Two Pointers "Sliding Window", and they point at different
    // reading. Collapsing them would hide which one you actually make.
    const recent = [...times(2, "sliding-window", "two-pointers"), ...times(2, "two-pointers", "sliding-window")];
    assert.equal(quizConfusions(st(recent)).pairs.length, 2);
  });

  test("test_confusions_mostConfusedFirst", () => {
    const recent = [...times(2, "a", "b"), ...times(4, "c", "d"), ...times(3, "e", "f")];
    assert.deepEqual(quizConfusions(st(recent)).pairs.map((p) => p.times), [4, 3, 2]);
  });
});

describe("answers recorded before the detail was kept", () => {
  test("test_confusions_oldBareAnswers_areCountedAsUngraded", () => {
    // Every answer logged before this shipped is `{correct: false}` and can
    // never appear in the list. Saying so is what stops the list looking
    // shorter than the score implies.
    const { pairs, graded, ungraded } = quizConfusions(st([
      { correct: false }, { correct: true }, ...times(2, "a", "b"),
    ]));
    assert.equal(ungraded, 2);
    assert.equal(graded, 2);
    assert.equal(pairs.length, 1);
  });

  test("test_confusions_halfRecordedAnswer_isNotTrusted", () => {
    // An entry with one side missing would otherwise pair against undefined.
    const { pairs, ungraded } = quizConfusions(st([
      { correct: false, actual: "a" }, { correct: false, said: "b" },
    ]));
    assert.deepEqual(pairs, []);
    assert.equal(ungraded, 2);
  });
});

describe("empty and missing state", () => {
  test("test_confusions_noAnswersYet_isEmptyNotNull", () => {
    assert.deepEqual(quizConfusions(st([])), { pairs: [], graded: 0, ungraded: 0 });
  });

  test("test_confusions_missingQuizBlock_doesNotThrow", () => {
    assert.doesNotThrow(() => quizConfusions({}));
  });
});
