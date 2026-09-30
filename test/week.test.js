// The week, as a shape somebody agrees to once (js/week.js).
//
// A daily minute budget could not express the thing people actually plan —
// "two problems Monday, one plus a design topic Tuesday, Saturday is the long
// design day" — and could not express a rest day at all, so every day off read
// as a failure. These pin the shapes, that the shapes hold their promised
// totals, and that a week somebody has edited by hand is never quietly
// regenerated underneath them.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DAYS, ITEM_KINDS, WEEK_TEMPLATES, DEFAULT_WEEK, LIGHT_DAY_PROBLEMS,
  weekPlan, weekSettings, templateByKey, dayKeyOf, todaysSlot, isRestDay,
  dayMinutes, weeklyCount, weeklyProblems, weeklyMinutes,
  dayProgress, weekProgress, problemsForBand, itemKind, setDayCheck,
} from "../js/week.js";

const MONDAY = "2026-09-28";      // a Monday
const SATURDAY = "2026-10-03";
const SUNDAY = "2026-10-04";

function makeSubject({ week = {}, problems = [], mocks = [], designProblems = [] } = {}) {
  return { settings: { week: { ...DEFAULT_WEEK, ...week } }, problems, mocks, designProblems };
}

const kindsOn = (plan, dayKey) =>
  plan.days.find((d) => d.day === dayKey).items.map((i) => i.kind);
const countOn = (plan, dayKey, kind) => {
  const item = plan.days.find((d) => d.day === dayKey).items.find((i) => i.kind === kind);
  return item ? item.count ?? 1 : 0;
};

describe("which day it is", () => {
  test("test_week_startsOnMonday", () => {
    // The week people plan in starts on Monday, whatever getDay() thinks.
    assert.equal(DAYS[0].key, "mon");
    assert.equal(DAYS[6].key, "sun");
  });

  test("test_week_dayKeyOf_mapsRealDates", () => {
    assert.equal(dayKeyOf(MONDAY), "mon");
    assert.equal(dayKeyOf(SATURDAY), "sat");
    assert.equal(dayKeyOf(SUNDAY), "sun");
  });
});

describe("the shape somebody described", () => {
  // Two problems Monday, one plus a design topic Tuesday, two Wednesday, one
  // plus a deep dive Thursday, two Friday, design mock Saturday, Sunday off.
  const plan = () => weekPlan(makeSubject({
    week: { template: "weekdaysPlusDesign", problems: 8, design: { perWeek: 2, kind: "designStudy" } },
  }));

  test("test_week_eightProblemsLandTwoOneTwoOneTwo", () => {
    const p = plan();
    assert.deepEqual(
      ["mon", "tue", "wed", "thu", "fri"].map((d) => countOn(p, d, "coding")),
      [2, 1, 2, 1, 2]);
  });

  test("test_week_designSitsOnTheLighterDays", () => {
    // Otherwise the design days become the heaviest days of the week, which is
    // how design quietly stops happening.
    const p = plan();
    assert.ok(kindsOn(p, "tue").includes("designStudy"));
    assert.ok(kindsOn(p, "thu").includes("designProblem"));
    assert.equal(countOn(p, "tue", "coding"), LIGHT_DAY_PROBLEMS);
    assert.equal(countOn(p, "thu", "coding"), LIGHT_DAY_PROBLEMS);
  });

  test("test_week_theLongDesignSessionGetsItsOwnDay", () => {
    assert.deepEqual(kindsOn(plan(), "sat"), ["designMock"]);
  });

  test("test_week_sundayIsGenuinelyOff", () => {
    assert.ok(isRestDay(plan().days.find((d) => d.day === "sun")));
  });

  test("test_week_addsUpToWhatWasAskedFor", () => {
    assert.equal(weeklyProblems(plan()), 8);
  });
});

describe("every template", () => {
  const design = { perWeek: 2, kind: "designStudy" };

  test("test_week_everyTemplateDeliversTheProblemsItWasAskedFor", () => {
    for (const t of WEEK_TEMPLATES) {
      for (const problems of [3, 5, 8, 12, 20]) {
        const built = t.build({ problems, design });
        const got = weeklyCount(built, "coding");
        assert.equal(got, problems, `${t.key} at ${problems}: delivered ${got}`);
      }
    }
  });

  test("test_week_everyTemplateCoversAllSevenDays", () => {
    for (const t of WEEK_TEMPLATES) {
      const built = t.build({ problems: 8, design });
      assert.deepEqual(built.days.map((d) => d.day), DAYS.map((d) => d.key), t.key);
    }
  });

  test("test_week_noTemplateLeavesADayWithNothingInIt", () => {
    // An empty day is ambiguous — rest, or an oversight? Rest is a decision
    // and has to be written down as one.
    for (const t of WEEK_TEMPLATES) {
      const built = t.build({ problems: 8, design });
      for (const d of built.days) assert.ok(d.items.length, `${t.key}: ${d.day} is empty`);
    }
  });

  test("test_week_mostTemplatesLeaveARestDay", () => {
    // A week with no rest day is a week somebody abandons in three.
    const withRest = WEEK_TEMPLATES.filter((t) =>
      t.build({ problems: 8, design }).days.some(isRestDay));
    assert.ok(withRest.length >= WEEK_TEMPLATES.length - 1,
      "almost every shape should leave somewhere to stop");
  });

  test("test_week_designOffMeansNoDesignAnywhere", () => {
    for (const t of WEEK_TEMPLATES) {
      const built = t.build({ problems: 8, design: { perWeek: 0, kind: "designStudy" } });
      const design = built.days.flatMap((d) => d.items).filter((i) => i.kind.startsWith("design"));
      // The Saturday template is explicitly a design shape; the rest must not
      // smuggle design in for somebody who turned it off.
      if (t.key !== "weekdaysPlusDesign") assert.equal(design.length, 0, t.key);
    }
  });

  test("test_week_everyTemplateExplainsWhoItIsFor", () => {
    for (const t of WEEK_TEMPLATES) {
      assert.ok(t.label && t.blurb.length > 30, `${t.key} does not say who it suits`);
    }
  });
});

describe("what a week costs", () => {
  test("test_week_dayMinutes_addsUpItsItems", () => {
    const day = { day: "mon", items: [{ kind: "coding", count: 2 }, { kind: "drill", count: 1 }] };
    assert.equal(dayMinutes(day), ITEM_KINDS.coding.minutesEach * 2 + ITEM_KINDS.drill.minutesEach);
  });

  test("test_week_aRestDayCostsNothing", () => {
    assert.equal(dayMinutes({ day: "sun", items: [{ kind: "rest" }] }), 0);
  });

  test("test_week_anUnknownItemIsIgnoredRatherThanCountedAsNaN", () => {
    assert.equal(dayMinutes({ day: "mon", items: [{ kind: "nonsense", count: 2 }] }), 0);
  });

  test("test_week_problemsForBand_scalesWithTheBand", () => {
    const light = problemsForBand({ min: 30, max: 45 }, 5);
    const heavy = problemsForBand({ min: 120, max: 180 }, 5);
    assert.ok(heavy > light);
    assert.ok(light >= 1, "even the lightest band asks for something");
  });

  test("test_week_weeklyMinutes_isTheSumOfItsDays", () => {
    const plan = weekPlan(makeSubject({ week: { template: "weekdays", problems: 5 } }));
    const sum = plan.days.reduce((n, d) => n + dayMinutes(d), 0);
    assert.equal(weeklyMinutes(plan), sum);
  });
});

describe("a week somebody has edited", () => {
  const custom = DAYS.map((d) => ({ day: d.key, items: [{ kind: "drill", count: 1 }] }));

  test("test_week_anEditedWeekWinsOutright", () => {
    const plan = weekPlan(makeSubject({ week: { template: "weekdays", problems: 8, days: custom } }));
    assert.equal(plan.edited, true);
    assert.equal(weeklyCount(plan, "coding"), 0);
  });

  test("test_week_anEditedWeekIsNotRegeneratedFromTheTemplate", () => {
    // Storing it whole rather than as a diff is the point: a template that
    // changed later would otherwise reshape a week somebody had already fixed.
    const plan = weekPlan(makeSubject({ week: { template: "daily", problems: 20, days: custom } }));
    assert.deepEqual(plan.days, custom);
  });

  test("test_week_aPartialWeekFallsBackToTheTemplate", () => {
    // Four days is not a week. Half-written state must not become the plan.
    const plan = weekPlan(makeSubject({ week: { template: "weekdays", problems: 6, days: custom.slice(0, 4) } }));
    assert.equal(plan.edited, false);
    assert.equal(weeklyCount(plan, "coding"), 6);
  });

  test("test_week_noSettingsAtAllStillGivesAWeek", () => {
    const plan = weekPlan({});
    assert.equal(plan.days.length, 7);
    assert.ok(weeklyProblems(plan) > 0);
  });
});

describe("how today is going", () => {
  const codingWeek = { template: "weekdays", problems: 10, design: { perWeek: 0, kind: "designStudy" } };
  const attempt = (date, over = {}) => ({ id: "a" + Math.random(), date, outcome: "solved-clean", ...over });
  const withAttempts = (n, date) => [{
    id: "p1", patternId: "x", attempts: Array.from({ length: n }, () => attempt(date)),
  }];

  test("test_week_todaysSlotKnowsWhatTodayIsFor", () => {
    const slot = todaysSlot(makeSubject({ week: codingWeek }), MONDAY);
    assert.equal(slot.label, "Monday");
    assert.ok(slot.items.some((i) => i.kind === "coding"));
  });

  test("test_week_nothingDoneYetLeavesTheWholeDayRemaining", () => {
    const p = dayProgress(makeSubject({ week: codingWeek }), MONDAY);
    assert.equal(p.complete, false);
    assert.ok(p.remaining.length);
  });

  test("test_week_progressIsCountedFromTheLogNotACheckbox", () => {
    const want = countOn(weekPlan(makeSubject({ week: codingWeek })), "mon", "coding");
    const p = dayProgress(makeSubject({ week: codingWeek, problems: withAttempts(want, MONDAY) }), MONDAY);
    assert.equal(p.complete, true, `${want} recorded did not finish a ${want}-problem day`);
  });

  test("test_week_yesterdaysWorkDoesNotFinishToday", () => {
    const p = dayProgress(makeSubject({ week: codingWeek, problems: withAttempts(5, "2026-09-27") }), MONDAY);
    assert.equal(p.complete, false);
  });

  test("test_week_aRestDayIsDoneOnArrival", () => {
    // Which is the entire point of having one.
    const p = dayProgress(makeSubject({ week: codingWeek }), SUNDAY);
    assert.equal(p.rested, true);
    assert.equal(p.complete, true);
    assert.equal(p.remaining.length, 0);
  });

  const readingWeek = {
    template: "weekdays", problems: 0,
    days: DAYS.map((d) => ({ day: d.key, items: [{ kind: "designStudy", count: 1 }] })),
  };

  test("test_week_somethingTheLogCannotSeeIsNotSilentlyDone", () => {
    // It used to be: the card said "Tuesday — done" while the design topic
    // sat unread, because reading leaves nothing in the log.
    const p = dayProgress(makeSubject({ week: readingWeek }), MONDAY);
    assert.equal(p.complete, false);
    assert.equal(p.items[0].manual, true, "an undetectable item is not marked as ticked by hand");
  });

  test("test_week_aTickFinishesIt", () => {
    const s = makeSubject({ week: readingWeek });
    setDayCheck(s, "designStudy", true, MONDAY);
    assert.equal(dayProgress(s, MONDAY).complete, true);
  });

  test("test_week_anUntickReopensIt", () => {
    const s = makeSubject({ week: readingWeek });
    setDayCheck(s, "designStudy", true, MONDAY);
    setDayCheck(s, "designStudy", false, MONDAY);
    assert.equal(dayProgress(s, MONDAY).complete, false);
  });

  test("test_week_aTickDoesNotCarryIntoTomorrow", () => {
    const s = makeSubject({ week: readingWeek });
    setDayCheck(s, "designStudy", true, MONDAY);
    assert.equal(dayProgress(s, "2026-09-29").complete, false);
  });

  test("test_week_aTickCannotFinishSomethingTheLogCanSee", () => {
    // Coding is counted from the log. A tick on it would be a second source
    // of truth about the same thing, and the two would disagree.
    const s = makeSubject({ week: { template: "weekdays", problems: 10 } });
    setDayCheck(s, "coding", true, MONDAY);
    assert.equal(dayProgress(s, MONDAY).complete, false);
  });

  test("test_week_oldTicksArePrunedOnTheWayThrough", () => {
    // Every byte of the synced file is paid for on every save.
    const s = makeSubject({ week: readingWeek });
    setDayCheck(s, "designStudy", true, "2026-08-01");
    setDayCheck(s, "designStudy", true, MONDAY);
    assert.deepEqual(Object.keys(s.dayChecks), [MONDAY]);
  });

  test("test_week_untickingTheLastThingLeavesNoEmptyDayBehind", () => {
    const s = makeSubject({ week: readingWeek });
    setDayCheck(s, "designStudy", true, MONDAY);
    setDayCheck(s, "designStudy", false, MONDAY);
    assert.deepEqual(s.dayChecks, {});
  });

  test("test_week_overdeliveringDoesNotBreakTheCount", () => {
    const p = dayProgress(makeSubject({ week: codingWeek, problems: withAttempts(20, MONDAY) }), MONDAY);
    assert.equal(p.complete, true);
    for (const i of p.items) assert.ok(i.got <= i.want, "a count ran past what was asked for");
  });

  test("test_week_weekProgressComparesSevenDaysAgainstThePlan", () => {
    const s = makeSubject({ week: codingWeek, problems: withAttempts(4, MONDAY) });
    const wp = weekProgress(s, MONDAY);
    assert.equal(wp.got, 4);
    assert.equal(wp.want, 10);
    assert.equal(wp.onTrack, false);
  });

  test("test_week_weekProgressIgnoresWorkOlderThanAWeek", () => {
    const s = makeSubject({ week: codingWeek, problems: withAttempts(9, "2026-09-01") });
    assert.equal(weekProgress(s, MONDAY).got, 0);
  });
});

describe("the item kinds", () => {
  test("test_week_everyKindSaysWhatItIsAndWhatItCosts", () => {
    for (const k of Object.values(ITEM_KINDS)) {
      assert.ok(k.label && k.blurb.length > 20, `${k.key} is unexplained`);
      assert.ok(k.minutesEach >= 0, `${k.key} has no cost`);
    }
  });

  test("test_week_restIsAKindRatherThanAnAbsence", () => {
    // So that a day off is something the plan says, not something it forgot.
    assert.ok(ITEM_KINDS.rest);
    assert.equal(ITEM_KINDS.rest.minutesEach, 0);
  });

  test("test_week_itemKind_unknownIsNullNotAThrow", () => {
    assert.equal(itemKind("nonsense"), null);
  });

  test("test_week_templateByKey_unknownFallsBackRatherThanThrowing", () => {
    assert.ok(templateByKey("nonsense"));
  });

  test("test_week_weekSettings_fillsInWhatIsMissing", () => {
    const s = weekSettings({ settings: { week: { problems: 3 } } });
    assert.equal(s.problems, 3);
    assert.ok(s.template && s.design);
  });
});

describe("somebody who has not set up a week", () => {
  test("test_week_weekConfigured_isFalseUntilOneIsSaved", async () => {
    const { weekConfigured } = await import("../js/week.js");
    assert.equal(weekConfigured({ settings: {} }), false);
    assert.equal(weekConfigured({ settings: { week: { template: "weekdays" } } }), true);
  });

  test("test_week_aNewLogDoesNotArriveWithAWeekAlreadyChosen", async () => {
    // Its absence is how the app knows nobody chose one. A default here put
    // rest days on weekends for people who never asked, and hid the coding
    // recommendation every Saturday.
    const { buildSeedState } = await import("../js/seed.js");
    assert.equal(buildSeedState().settings.week, undefined);
  });
});
