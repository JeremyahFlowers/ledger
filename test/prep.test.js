// What you are preparing for, and what that changes (js/prep.js).
//
// The app used to know how long a day was and nothing else, so it gave the
// same advice to somebody six months out as to somebody interviewing on
// Friday, and the same advice to a new grad as to a senior. These pin the four
// answers that make those different, and — more importantly — pin that giving
// none of them leaves the app behaving exactly as it did before. Nobody is
// made to fill in a form to get sensible defaults.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  STARTING_POINTS, TARGETS, LEVELS, INTENSITIES, PREP_PHASES,
  SUSTAINABLE_MAX, MIN_USEFUL_DAY, LONG_DAY_MIN,
  prepOf, weeksUntil, prepPhase, suggestIntensity, currentIntensity,
  dailyBand, dayPlan, bandAdvice, prepStatus,
} from "../js/prep.js";
import { addDaysISO } from "../js/logic.js";

const TODAY = "2026-09-26";
const inWeeks = (n) => addDaysISO(TODAY, n * 7);

/** A state with whatever prep answers the test cares about. */
function makeSubject({ prep = {}, budget, floor } = {}) {
  return {
    settings: {
      ...(budget == null ? {} : { dailyBudgetMin: budget }),
      ...(floor == null ? {} : { dailyFloorMin: floor }),
      prep: { ...prep },
    },
  };
}

describe("answering none of it", () => {
  test("test_prep_noAnswers_stillHasADefaultProfile", () => {
    const p = prepOf({});
    assert.equal(p.targetDate, null);
    assert.ok(p.startingPoint && p.target && p.level);
  });

  test("test_prep_noTargetDate_hasNoCountdown", () => {
    assert.equal(weeksUntil(makeSubject(), TODAY), null);
  });

  test("test_prep_noTargetDate_staysOnMixedPractice", () => {
    // Which is what the app did before any of this existed. Nobody is made to
    // pick a date to get the behaviour they already had.
    assert.equal(prepPhase(makeSubject(), TODAY).key, "mixed");
  });

  test("test_prep_noAnswers_isNotReportedAsConfigured", () => {
    assert.equal(prepStatus(makeSubject(), TODAY).configured, false);
  });

  test("test_prep_aSavedBudgetIsNeverOverwrittenByASuggestion", () => {
    // Somebody who set 90 minutes by hand means 90 minutes.
    const band = dailyBand(makeSubject({ budget: 90, floor: 60 }), TODAY);
    assert.deepEqual(band, { min: 60, max: 90 });
  });
});

describe("how far out the interview is", () => {
  test("test_prep_weeksUntil_countsWholeWeeks", () => {
    assert.equal(weeksUntil(makeSubject({ prep: { targetDate: inWeeks(6) } }), TODAY), 6);
  });

  test("test_prep_weeksUntil_theDayItselfIsZeroNotMinusOne", () => {
    assert.equal(weeksUntil(makeSubject({ prep: { targetDate: TODAY } }), TODAY), 0);
  });

  test("test_prep_weeksUntil_aPastDateDoesNotGoNegative", () => {
    // A date that has been and gone is zero weeks out, not minus three — the
    // countdown should read "now", not run backwards.
    assert.equal(weeksUntil(makeSubject({ prep: { targetDate: addDaysISO(TODAY, -21) } }), TODAY), 0);
  });

  test("test_prep_weeksUntil_roundsPartWeeksUp", () => {
    assert.equal(weeksUntil(makeSubject({ prep: { targetDate: addDaysISO(TODAY, 8) } }), TODAY), 2);
  });
});

describe("which part of the preparation this is", () => {
  const withPlan = (startedDaysAgo, weeksOut) => makeSubject({
    prep: { startedOn: addDaysISO(TODAY, -startedDaysAgo), targetDate: inWeeks(weeksOut) },
  });

  test("test_prep_earlyInAPlan_isFoundations", () => {
    assert.equal(prepPhase(withPlan(7, 11), TODAY).key, "foundations");
  });

  test("test_prep_middleOfAPlan_isMixed", () => {
    assert.equal(prepPhase(withPlan(42, 6), TODAY).key, "mixed");
  });

  test("test_prep_endOfAPlan_isSimulation", () => {
    assert.equal(prepPhase(withPlan(77, 3), TODAY).key, "simulation");
  });

  test("test_prep_phasesAreProportionsNotFixedWeeks", () => {
    // "Topic blocks for two months then mix it up" is advice about
    // proportions. Six weeks and six months both need a foundations stretch
    // and a simulation stretch, at different lengths — so the same fraction
    // through two different plans is the same phase.
    const shortPlan = makeSubject({ prep: { startedOn: addDaysISO(TODAY, -7), targetDate: inWeeks(5) } });
    const longPlan = makeSubject({ prep: { startedOn: addDaysISO(TODAY, -28), targetDate: inWeeks(20) } });
    assert.equal(prepPhase(shortPlan, TODAY).key, prepPhase(longPlan, TODAY).key);
  });

  test("test_prep_theLastFortnightIsAlwaysSimulation", () => {
    // However long the plan was. Two weeks out, the gap being closed is
    // performance rather than knowledge.
    const justStarted = makeSubject({ prep: { startedOn: TODAY, targetDate: inWeeks(1) } });
    assert.equal(prepPhase(justStarted, TODAY).key, "simulation");
  });

  test("test_prep_aDateWithNoStartStillPicksSomethingSensible", () => {
    // Somebody who sets a date months out has not "started" a plan yet.
    assert.equal(prepPhase(makeSubject({ prep: { targetDate: inWeeks(20) } }), TODAY).key, "foundations");
    assert.equal(prepPhase(makeSubject({ prep: { targetDate: inWeeks(6) } }), TODAY).key, "mixed");
  });

  test("test_prep_everyPhaseSaysWhatItChanges", () => {
    for (const p of Object.values(PREP_PHASES)) {
      assert.ok(p.label && p.blurb, `${p.key} is unlabelled`);
      assert.ok(p.detail.length > 80, `${p.key} does not say why`);
    }
  });
});

describe("how hard a day should be", () => {
  test("test_prep_shortRunwayRaisesTheIntensity", () => {
    const relaxed = makeSubject({ prep: { startingPoint: "rusty", targetDate: inWeeks(12) } });
    const tight = makeSubject({ prep: { startingPoint: "rusty", targetDate: inWeeks(3) } });
    const order = INTENSITIES.map((i) => i.key);
    assert.ok(order.indexOf(suggestIntensity(tight, TODAY).key)
      > order.indexOf(suggestIntensity(relaxed, TODAY).key));
  });

  test("test_prep_aStandingStartRaisesIt", () => {
    const rusty = makeSubject({ prep: { startingPoint: "rusty", targetDate: inWeeks(8) } });
    const brandNew = makeSubject({ prep: { startingPoint: "new", targetDate: inWeeks(8) } });
    const order = INTENSITIES.map((i) => i.key);
    assert.ok(order.indexOf(suggestIntensity(brandNew, TODAY).key)
      >= order.indexOf(suggestIntensity(rusty, TODAY).key));
  });

  test("test_prep_neverSuggestsFullTime", () => {
    // That is a statement about somebody's week, not something to infer from
    // a date in a form.
    for (const startingPoint of STARTING_POINTS.map((s) => s.key)) {
      for (const w of [0, 1, 2, 3, 6, 12, 26]) {
        const got = suggestIntensity(makeSubject({ prep: { startingPoint, targetDate: inWeeks(w) } }), TODAY);
        assert.notEqual(got.key, "fulltime", `${startingPoint} at ${w} weeks`);
      }
    }
  });

  test("test_prep_aChosenIntensityWins", () => {
    const s = makeSubject({ prep: { intensity: "light", startingPoint: "new", targetDate: inWeeks(2) } });
    assert.equal(currentIntensity(s, TODAY).key, "light");
  });

  test("test_prep_withNothingChosenItFollowsTheSuggestion", () => {
    const s = makeSubject({ prep: { startingPoint: "rusty", targetDate: inWeeks(6) } });
    assert.equal(currentIntensity(s, TODAY).key, suggestIntensity(s, TODAY).key);
    assert.equal(prepStatus(s, TODAY).followingSuggestion, true);
  });

  test("test_prep_everyIntensityIsARangeNotANumber", () => {
    // A day is a band: a floor below which there was no room for the review,
    // and a ceiling past which it stops being deliberate.
    for (const i of INTENSITIES) {
      assert.ok(i.band[0] < i.band[1], `${i.key} is not a band`);
      assert.ok(i.note.length > 40, `${i.key} does not say what it costs`);
    }
  });

  test("test_prep_intensitiesAreOrderedByEffort", () => {
    for (let i = 1; i < INTENSITIES.length; i++) {
      assert.ok(INTENSITIES[i].band[0] >= INTENSITIES[i - 1].band[0], `${INTENSITIES[i].key} is out of order`);
    }
  });

  test("test_prep_longDaysAreSplitIntoBlocks", () => {
    for (const i of INTENSITIES) {
      if (i.band[1] > LONG_DAY_MIN) assert.ok(i.blocks > 1, `${i.key} is one long sitting`);
    }
  });
});

describe("the shape of a day", () => {
  test("test_prep_aShortDayIsOneBlock", () => {
    const plan = dayPlan(makeSubject({ budget: 75, floor: 45 }), TODAY);
    assert.equal(plan.blocks.length, 1);
  });

  test("test_prep_aLongDayIsTwoSittingsWithABreak", () => {
    // Four hours in one sitting is three hours of skimming.
    const plan = dayPlan(makeSubject({ budget: 200, floor: 160, prep: { intensity: "fulltime" } }), TODAY);
    assert.equal(plan.blocks.length, 2);
    assert.ok(plan.splitReason, "it split the day without saying why");
  });

  test("test_prep_everyBlockHasAWarmUpACoreAndAReview", () => {
    const plan = dayPlan(makeSubject({ budget: 200, floor: 160, prep: { intensity: "fulltime" } }), TODAY);
    for (const b of plan.blocks) {
      assert.deepEqual(b.parts.map((p) => p.key), ["warmup", "core", "review"]);
    }
  });

  test("test_prep_theReviewIsNeverTheLeftovers", () => {
    // It is the part that gets skipped first and teaches most, so it has to be
    // a real slice at every size the app offers.
    for (const i of INTENSITIES) {
      const plan = dayPlan(makeSubject({ prep: { intensity: i.key } }), TODAY);
      for (const b of plan.blocks) {
        const review = b.parts.find((p) => p.key === "review");
        assert.ok(review.minutes >= 5, `${i.key}: review is ${review.minutes} minutes`);
      }
    }
  });

  test("test_prep_aBlockAddsUpToItsOwnLength", () => {
    for (const i of INTENSITIES) {
      const plan = dayPlan(makeSubject({ prep: { intensity: i.key } }), TODAY);
      for (const b of plan.blocks) {
        const sum = b.parts.reduce((n, p) => n + p.minutes, 0);
        assert.equal(sum, b.minutes, `${i.key}: parts sum to ${sum} of ${b.minutes}`);
      }
    }
  });

  test("test_prep_everyPartSaysWhatItIsFor", () => {
    const plan = dayPlan(makeSubject({ prep: { intensity: "focused" } }), TODAY);
    for (const p of plan.blocks[0].parts) {
      assert.ok(p.prompt.length > 40, `${p.key} has no guidance`);
    }
  });
});

describe("saying when a band is a bad idea", () => {
  test("test_prep_aSustainableBandPassesQuietly", () => {
    assert.equal(bandAdvice(makeSubject({ budget: 120, floor: 75 }), TODAY).level, "ok");
  });

  test("test_prep_oneLongSittingIsCalledOut", () => {
    const s = makeSubject({ budget: 180, floor: 120, prep: { intensity: "focused" } });
    assert.equal(bandAdvice(s, TODAY).level, "warn");
  });

  test("test_prep_aLongDayAlreadySplitIsNotScolded", () => {
    // It says what is happening rather than telling somebody off for a
    // decision the app already helped them make.
    const s = makeSubject({ budget: 180, floor: 120, prep: { intensity: "rigorous" } });
    const advice = bandAdvice(s, TODAY);
    assert.equal(advice.level, "warn");
    assert.match(advice.message, /two sittings|blocks/);
  });

  test("test_prep_pastFourHoursIsCalledWhatItIs", () => {
    assert.equal(bandAdvice(makeSubject({ budget: 300, floor: 240 }), TODAY).level, "bad");
  });

  test("test_prep_aDayWithNoRoomForReviewIsCalledOut", () => {
    assert.equal(bandAdvice(makeSubject({ budget: 15, floor: 10 }), TODAY).level, "warn");
  });

  test("test_prep_aFloorEqualToTheCeilingIsNotABand", () => {
    const advice = bandAdvice(makeSubject({ budget: 75, floor: 75 }), TODAY);
    assert.equal(advice.level, "warn");
  });

  test("test_prep_theSustainableCeilingIsTwoHours", () => {
    // The number the advice is built on, stated once so it cannot drift.
    assert.equal(SUSTAINABLE_MAX, 120);
    assert.ok(MIN_USEFUL_DAY > 0 && MIN_USEFUL_DAY < SUSTAINABLE_MAX);
  });
});

describe("what the target changes", () => {
  test("test_prep_everyTargetSaysWhatItAssumesAndWhatItTests", () => {
    for (const t of TARGETS) {
      assert.ok(t.note.length > 60, `${t.key} does not say what it weights`);
      assert.ok(t.emphasis.length, `${t.key} weights nothing`);
    }
  });

  test("test_prep_topTierWeightsFluencyAndCleanCode", () => {
    // The distinction is not the company's name, it is what the loop assumes
    // you already have.
    const top = TARGETS.find((t) => t.key === "top");
    assert.ok(top.emphasis.includes("fluency"));
    assert.ok(top.emphasis.includes("clean"));
  });

  test("test_prep_theLevelDecidesWhetherDesignIsPartOfTheDay", () => {
    const byKey = Object.fromEntries(LEVELS.map((l) => [l.key, l]));
    assert.equal(byKey.newgrad.designShare, 0);
    assert.ok(byKey.senior.designShare > byKey.mid.designShare);
  });

  test("test_prep_statusCarriesTheEmphasisThroughToTheCaller", () => {
    const s = makeSubject({ prep: { target: "top" } });
    assert.ok(prepStatus(s, TODAY).emphasis.includes("fluency"));
  });
});

describe("the one honest warning", () => {
  test("test_prep_aRunwayShorterThanTheGroundIsFlagged", () => {
    // Said once, plainly. It is their date and their call.
    const s = makeSubject({ prep: { startingPoint: "new", targetDate: inWeeks(4) } });
    assert.equal(prepStatus(s, TODAY).tight, true);
  });

  test("test_prep_anHonestRunwayIsNotFlagged", () => {
    const s = makeSubject({ prep: { startingPoint: "rusty", targetDate: inWeeks(10) } });
    assert.equal(prepStatus(s, TODAY).tight, false);
  });

  test("test_prep_noDateIsNotAWarning", () => {
    assert.equal(prepStatus(makeSubject(), TODAY).tight, false);
  });
});
