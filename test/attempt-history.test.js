// Tests for correcting a problem's history (js/logic.js).
//
// Attempts were write-once. A wrong outcome, a mistyped note, or a session
// logged against the wrong problem was permanent, and skewed every statistic
// downstream with no way to say so.
//
// The subtle part is the schedule. applyOutcome advances the box one attempt
// at a time, which is fine while attempts only ever arrive — but the moment
// one can be removed, an incrementally-built box no longer follows from the
// record it claims to summarise. Delete the failure that reset you to box 0
// and the schedule still believes it happened. These pin the replay.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  recomputeSchedule, removeAttempt, editAttempt, applyOutcome, lastAttemptWithCode, OUTCOMES, nextBox,
  todayISO, addDaysISO, STATUS_ACTIVE,
} from "../js/logic.js";

const SETTINGS = { boxIntervalsDays: [0, 1, 3, 7, 16, 35] };

let seq = 0;
const attempt = (outcome, daysAgo) => ({
  id: `a${seq++}`, date: addDaysISO(todayISO(), -daysAgo), outcome,
  patternGuess: "correct", timeToInsightMin: 5, timeToSolveMin: 20,
  mistakeTags: [], soulStatement: "",
});

const makeProblem = (attempts = []) => ({
  id: "p1", name: "3Sum", number: 15, difficulty: "Medium",
  patternId: "two-pointers", status: STATUS_ACTIVE, box: 0,
  nextReviewDate: todayISO(), attempts,
});

describe("recomputeSchedule", () => {
  test("test_recompute_cleanSolves_climbTheBoxes", () => {
    const p = makeProblem([attempt("solved-clean", 30), attempt("solved-clean", 20), attempt("solved-clean", 10)]);
    assert.equal(recomputeSchedule(p, SETTINGS).box, 3);
  });

  test("test_recompute_aFailureResetsToZero", () => {
    const p = makeProblem([attempt("solved-clean", 30), attempt("solved-clean", 20), attempt("failed", 10)]);
    assert.equal(recomputeSchedule(p, SETTINGS).box, 0);
  });

  test("test_recompute_struggleHoldsTheBox", () => {
    const p = makeProblem([attempt("solved-clean", 30), attempt("solved-struggled", 10)]);
    assert.equal(recomputeSchedule(p, SETTINGS).box, 1);
  });

  test("test_recompute_boxNeverExceedsTheIntervalTable", () => {
    const p = makeProblem(Array.from({ length: 20 }, (_, i) => attempt("solved-clean", 40 - i)));
    assert.equal(recomputeSchedule(p, SETTINGS).box, SETTINGS.boxIntervalsDays.length - 1);
  });

  test("test_recompute_matchesApplyOutcomeForAnAppendOnlyHistory", () => {
    // The replay must agree with the incremental path, or correcting an
    // attempt would silently reschedule an untouched problem.
    const incremental = makeProblem();
    const outcomes = ["solved-clean", "solved-clean", "failed", "solved-clean"];
    outcomes.forEach((o) => applyOutcome(incremental, o, SETTINGS));

    const replayed = makeProblem(outcomes.map((o, i) => attempt(o, 10 - i)));
    recomputeSchedule(replayed, SETTINGS);
    assert.equal(replayed.box, incremental.box);
  });

  test("test_recompute_readsHistoryInDateOrderNotArrayOrder", () => {
    // Nothing guarantees the array is sorted — an imported or hand-merged file
    // may not be, and order decides the box.
    const p = makeProblem([attempt("failed", 5), attempt("solved-clean", 30), attempt("solved-clean", 20)]);
    // Chronologically: clean, clean, failed -> 0.
    assert.equal(recomputeSchedule(p, SETTINGS).box, 0);
  });

  test("test_recompute_schedulesFromTheLastAttemptNotFromToday", () => {
    // A correction made weeks later must not push the next refresher weeks out.
    const p = makeProblem([attempt("solved-clean", 10)]);
    recomputeSchedule(p, SETTINGS);
    assert.equal(p.nextReviewDate, addDaysISO(addDaysISO(todayISO(), -10), 1));
  });

  test("test_recompute_noHistoryLeft_resetsToAFreshProblem", () => {
    const p = makeProblem([]);
    p.box = 4;
    recomputeSchedule(p, SETTINGS);
    assert.equal(p.box, 0);
    assert.equal(p.nextReviewDate, todayISO());
  });
});

describe("removeAttempt", () => {
  test("test_removeAttempt_dropsItAndRewindsTheSchedule", () => {
    const bad = attempt("failed", 5);
    const p = makeProblem([attempt("solved-clean", 30), attempt("solved-clean", 20), bad]);
    recomputeSchedule(p, SETTINGS);
    assert.equal(p.box, 0, "the failure knocked it back");

    removeAttempt(p, bad.id, SETTINGS);
    assert.equal(p.attempts.length, 2);
    assert.equal(p.box, 2, "removing the failure must also undo its effect");
  });

  test("test_removeAttempt_returnsWhatItRemoved", () => {
    const doomed = attempt("failed", 1);
    const p = makeProblem([doomed]);
    assert.equal(removeAttempt(p, doomed.id, SETTINGS)?.id, doomed.id);
  });

  test("test_removeAttempt_unknownId_changesNothing", () => {
    const p = makeProblem([attempt("solved-clean", 5)]);
    assert.equal(removeAttempt(p, "nope", SETTINGS), null);
    assert.equal(p.attempts.length, 1);
  });

  test("test_removeAttempt_theOnlyAttempt_leavesAProblemWithNoHistory", () => {
    const only = attempt("solved-clean", 3);
    const p = makeProblem([only]);
    recomputeSchedule(p, SETTINGS);
    removeAttempt(p, only.id, SETTINGS);
    assert.deepEqual(p.attempts, []);
    assert.equal(p.box, 0);
  });
});

describe("editAttempt", () => {
  test("test_editAttempt_correctingAnOutcome_rewritesTheSchedule", () => {
    const wrong = attempt("failed", 5);
    const p = makeProblem([attempt("solved-clean", 30), wrong]);
    recomputeSchedule(p, SETTINGS);
    assert.equal(p.box, 0);

    editAttempt(p, wrong.id, { outcome: "solved-clean" }, SETTINGS);
    assert.equal(p.box, 2, "the schedule must follow the corrected record");
  });

  test("test_editAttempt_fixesANote", () => {
    const a = attempt("solved-clean", 2);
    const p = makeProblem([a]);
    editAttempt(p, a.id, { soulStatement: "the window only shrinks from the left" }, SETTINGS);
    assert.equal(p.attempts[0].soulStatement, "the window only shrinks from the left");
  });

  test("test_editAttempt_refusesToRewriteWhatIsNotAnOpinion", () => {
    // The date and the code are a record of what happened, not a field.
    const a = attempt("solved-clean", 2);
    const originalDate = a.date;
    const p = makeProblem([a]);
    editAttempt(p, a.id, { date: "1999-01-01", id: "hacked", code: "rewritten" }, SETTINGS);
    assert.equal(p.attempts[0].date, originalDate);
    assert.equal(p.attempts[0].id, a.id);
    assert.equal(p.attempts[0].code, undefined);
  });

  test("test_editAttempt_unknownId_isNull", () => {
    const p = makeProblem([attempt("solved-clean", 1)]);
    assert.equal(editAttempt(p, "nope", { outcome: "failed" }, SETTINGS), null);
  });
});

describe("lastAttemptWithCode", () => {
  // Coming back to a problem you solved a month ago is exactly when your old
  // solution is worth the most — and exactly when showing it unprompted would
  // hand you the answer before you had tried. The workspace puts it behind a
  // reveal; this picks which one to offer.
  test("test_lastAttemptWithCode_noAttempts_isNull", () => {
    assert.equal(lastAttemptWithCode(makeProblem([])), null);
  });

  test("test_lastAttemptWithCode_attemptsWithoutCode_isNull", () => {
    // Manually logged reps record no code.
    assert.equal(lastAttemptWithCode(makeProblem([attempt("solved-clean", 5)])), null);
  });

  test("test_lastAttemptWithCode_picksTheMostRecentOne", () => {
    const old = { ...attempt("solved-clean", 40), code: "old" };
    const recent = { ...attempt("failed", 3), code: "recent" };
    assert.equal(lastAttemptWithCode(makeProblem([old, recent])).code, "recent");
  });

  test("test_lastAttemptWithCode_ignoresLaterAttemptsThatHaveNoCode", () => {
    // A later manual log must not hide the last real solution.
    const withCode = { ...attempt("solved-clean", 20), code: "the good one" };
    assert.equal(lastAttemptWithCode(makeProblem([withCode, attempt("solved-clean", 1)])).code, "the good one");
  });

  test("test_lastAttemptWithCode_whitespaceOnlyCode_doesNotCount", () => {
    assert.equal(lastAttemptWithCode(makeProblem([{ ...attempt("solved-clean", 2), code: "   \n " }])), null);
  });

  test("test_lastAttemptWithCode_missingProblem_doesNotThrow", () => {
    assert.equal(lastAttemptWithCode(null), null);
    assert.equal(lastAttemptWithCode({}), null);
  });
});

describe("outcomes", () => {
  // "Failed" was doing too much work: running out of time on a hard problem
  // you understood is not the same as not getting it, and collapsing them made
  // the clean-solve rate say less than it could.
  //
  // The table is also the single definition. It used to be five separate
  // lists — two <select>s, a glyph map, a label map and a pair of if-chains in
  // the scheduler — which is four chances for a new outcome to be half-added.
  test("test_outcomes_everyOneIsFullyDescribed", () => {
    for (const o of OUTCOMES) {
      assert.ok(o.value && o.label && o.symbol && o.cls, `${o.value} is incomplete`);
      assert.ok(["up", "hold", "back", "reset"].includes(o.box), `${o.value} has no box effect`);
    }
  });

  test("test_nextBox_cleanSolveClimbs", () => {
    assert.equal(nextBox(2, "solved-clean", 6), 3);
  });

  test("test_nextBox_struggleHolds", () => {
    assert.equal(nextBox(2, "solved-struggled", 6), 2);
  });

  test("test_nextBox_ranOutOfTime_stepsBackOneRatherThanResetting", () => {
    // You didn't finish, so you lose ground — but not all of it, which is
    // what separates this from not getting it at all.
    assert.equal(nextBox(3, "ran-out-of-time", 6), 2);
  });

  test("test_nextBox_ranOutOfTimeAtTheBottom_staysThere", () => {
    assert.equal(nextBox(0, "ran-out-of-time", 6), 0);
  });

  test("test_nextBox_failureResets", () => {
    assert.equal(nextBox(5, "failed", 6), 0);
  });

  test("test_nextBox_neverExceedsTheTable", () => {
    assert.equal(nextBox(5, "solved-clean", 6), 5);
  });

  test("test_nextBox_unknownOutcome_holdsRatherThanThrowing", () => {
    // An attempt written by an older or newer version must not break the
    // replay of a whole history.
    assert.equal(nextBox(3, "something-else", 6), 3);
  });

  test("test_recompute_handlesRanOutOfTimeInAReplay", () => {
    const p = makeProblem([
      attempt("solved-clean", 30), attempt("solved-clean", 20), attempt("ran-out-of-time", 10),
    ]);
    // Two clean solves to box 2, then a step back to 1.
    assert.equal(recomputeSchedule(p, SETTINGS).box, 1);
  });

  test("test_applyOutcome_andReplay_agreeOnRanOutOfTime", () => {
    // The scheduler and the replay read the same table, so correcting an
    // attempt can't silently reschedule an untouched problem.
    const incremental = makeProblem();
    ["solved-clean", "solved-clean", "ran-out-of-time"].forEach((o) => applyOutcome(incremental, o, SETTINGS));
    const replayed = makeProblem([
      attempt("solved-clean", 12), attempt("solved-clean", 11), attempt("ran-out-of-time", 10)]);
    recomputeSchedule(replayed, SETTINGS);
    assert.equal(replayed.box, incremental.box);
  });
});
