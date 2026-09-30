// A long day, run as steps with a break in the middle (js/long-session.js).
//
// "Saturday: three hours of system design" is a commitment with no shape, and
// three hours with no shape becomes ninety minutes of reading. These pin the
// shape — two sittings, a real break, each step with a job — and that a run
// keeps its place while you are off doing each part.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  BREAK_MIN, longSessionFor, totalMinutes,
  startRun, runIsCurrent, advanceRun, runFinished, stepRemaining,
} from "../js/long-session.js";

const SATURDAY = "2026-10-03";
const MONDAY = "2026-09-28";

const designWeek = { template: "weekdaysPlusDesign", problems: 8, design: { perWeek: 2, kind: "designStudy" }, days: null };

function makeSubject({ week = designWeek, prep = {}, floor, ceiling } = {}) {
  return {
    settings: {
      ...(week ? { week } : {}),
      ...(floor == null ? {} : { dailyFloorMin: floor }),
      ...(ceiling == null ? {} : { dailyBudgetMin: ceiling }),
      prep,
    },
    problems: [], mocks: [], designProblems: [],
  };
}

describe("which days are long", () => {
  test("test_long_theDesignSaturdayIsALongSession", () => {
    const plan = longSessionFor(makeSubject(), SATURDAY);
    assert.equal(plan.kind, "design");
  });

  test("test_long_anOrdinaryWeekdayIsNot", () => {
    assert.equal(longSessionFor(makeSubject({ floor: 90, ceiling: 120 }), MONDAY), null);
  });

  test("test_long_aDayWhoseBandSplitsIsATwoBlockCodingSession", () => {
    const plan = longSessionFor(makeSubject({ floor: 150, ceiling: 200, prep: { intensity: "rigorous" } }), MONDAY);
    assert.equal(plan.kind, "coding");
  });

  test("test_long_noWeekSetUpMeansNoLongSession", () => {
    // Nothing reads from a week nobody chose.
    assert.equal(longSessionFor(makeSubject({ week: null }), SATURDAY), null);
  });
});

describe("the shape of the long design session", () => {
  const plan = () => longSessionFor(makeSubject(), SATURDAY);

  test("test_long_itIsTwoSittingsWithOneBreak", () => {
    const steps = plan().steps;
    const breaks = steps.filter((s) => s.isBreak);
    assert.equal(breaks.length, 1);
    const i = steps.indexOf(breaks[0]);
    assert.ok(i > 0 && i < steps.length - 1, "the break is not between two blocks");
  });

  test("test_long_theBreakIsLongEnoughToLeaveTheDesk", () => {
    assert.equal(plan().steps.find((s) => s.isBreak).minutes, BREAK_MIN);
    assert.ok(BREAK_MIN >= 10);
  });

  test("test_long_itAddsUpToTheDayTheWeekGaveIt", () => {
    // The week puts three hours on Saturday; the plan spends three hours.
    assert.equal(totalMinutes(plan().steps), 180);
  });

  test("test_long_itEndsByWritingDownWhatBroke", () => {
    // The one output of the day still useful next week.
    const steps = plan().steps;
    assert.equal(steps[steps.length - 1].key, "writeup");
  });

  test("test_long_itBuildsBeforeItBreaks", () => {
    const keys = plan().steps.map((s) => s.key);
    assert.ok(keys.indexOf("blueprint") < keys.indexOf("deconstruct"));
    assert.ok(keys.indexOf("deconstruct") < keys.indexOf("stress"));
  });

  test("test_long_everyWorkingStepSaysWhatToDoAndWhere", () => {
    for (const s of plan().steps.filter((x) => !x.isBreak)) {
      assert.ok(s.prompt.length > 40, `${s.key} has no guidance`);
      assert.ok(s.action, `${s.key} does not say where to go`);
      assert.ok(s.minutes >= 5, `${s.key} is ${s.minutes} minutes`);
    }
  });
});

describe("a two-block coding day", () => {
  const plan = () => longSessionFor(makeSubject({ floor: 150, ceiling: 200, prep: { intensity: "rigorous" } }), MONDAY);

  test("test_long_codingBlocksAreSeparatedByABreak", () => {
    const steps = plan().steps;
    assert.equal(steps.filter((s) => s.isBreak).length, 1);
  });

  test("test_long_eachCodingBlockHasAWarmUpACoreAndAReview", () => {
    const labels = plan().steps.filter((s) => !s.isBreak).map((s) => s.key.replace(/-\d$/, ""));
    assert.deepEqual(labels, ["warmup", "core", "review", "warmup", "core", "review"]);
  });

  test("test_long_theCoreStepStartsARealSession", () => {
    const core = plan().steps.find((s) => s.key.startsWith("core"));
    assert.equal(core.action.start, "recommended");
  });

  test("test_long_aTopTierWarmUpGoesToTheLanguageDrill", () => {
    const p = longSessionFor(makeSubject({ floor: 150, ceiling: 200, prep: { intensity: "rigorous", target: "top" } }), MONDAY);
    assert.deepEqual(p.steps[0].action, { tab: "quiz", mode: "language" });
  });
});

describe("keeping your place", () => {
  const plan = () => longSessionFor(makeSubject(), SATURDAY);

  test("test_long_aRunStartsAtTheFirstStep", () => {
    const run = startRun(plan(), SATURDAY, 1000);
    assert.equal(run.index, 0);
    assert.equal(run.startedAt, 1000);
  });

  test("test_long_advancingRecordsWhatWasDoneAndHowLongItTook", () => {
    const p = plan();
    const run = advanceRun(startRun(p, SATURDAY, 0), p, {}, 30 * 60000);
    assert.equal(run.index, 1);
    assert.deepEqual(run.done[0], { key: p.steps[0].key, skipped: false, minutes: 30 });
  });

  test("test_long_aSkipIsRecordedNotLost", () => {
    const p = plan();
    const run = advanceRun(startRun(p, SATURDAY, 0), p, { skipped: true }, 60000);
    assert.equal(run.done[0].skipped, true);
  });

  test("test_long_theNextStepsClockStartsWhenItIsReached", () => {
    const p = plan();
    const run = advanceRun(startRun(p, SATURDAY, 0), p, {}, 5000);
    assert.equal(run.startedAt, 5000);
  });

  test("test_long_itFinishesAfterTheLastStep", () => {
    const p = plan();
    let run = startRun(p, SATURDAY, 0);
    for (let i = 0; i < p.steps.length; i++) run = advanceRun(run, p, {}, i * 1000);
    assert.equal(runFinished(run, p), true);
    assert.equal(run.done.length, p.steps.length);
  });

  test("test_long_advancingPastTheEndIsHarmless", () => {
    const p = plan();
    const end = { ...startRun(p, SATURDAY, 0), index: p.steps.length };
    assert.deepEqual(advanceRun(end, p, {}, 99), end);
  });

  test("test_long_yesterdaysRunIsNotTodays", () => {
    const p = plan();
    assert.equal(runIsCurrent(startRun(p, "2026-10-02"), p, SATURDAY), false);
    assert.equal(runIsCurrent(startRun(p, SATURDAY), p, SATURDAY), true);
  });

  test("test_long_aRunOfTheOtherKindDoesNotApply", () => {
    const p = plan();
    assert.equal(runIsCurrent({ ...startRun(p, SATURDAY), kind: "coding" }, p, SATURDAY), false);
  });

  test("test_long_nothingStoredIsNotARun", () => {
    assert.equal(runIsCurrent(null, plan(), SATURDAY), false);
  });

  test("test_long_stepRemaining_countsDownThenOver", () => {
    const step = { minutes: 10 };
    assert.equal(Math.round(stepRemaining(step, 0, 4 * 60000).remainingMin), 6);
    assert.equal(stepRemaining(step, 0, 12 * 60000).overrun, true);
  });
});
