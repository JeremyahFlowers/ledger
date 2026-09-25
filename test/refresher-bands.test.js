// How the refresher queue bands what's in it (js/logic.js).
//
// The queue banded on days-since-practice alone, and that is null when there
// is no history — so a never-practised problem fell into the oldest bucket and
// a brand-new account opened on "23, a month or more". That is the deadline
// framing this app specifically removed, surviving in the one view named after
// removing it, and greeting every new user on their first screen.
//
// refresherStatus had returned a `new` tone for exactly this case the whole
// time. The queue never read it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { refresherBands, bandOf, REFRESHER_BANDS, todayISO, addDaysISO } from "../js/logic.js";

const problem = (attempts = [], over = {}) => ({
  id: "p", name: "P", number: 1, difficulty: "Medium", patternId: "two-pointers",
  status: "active", box: 0, nextReviewDate: todayISO(), attempts, ...over,
});
const practisedDaysAgo = (n) => ({
  id: `a${n}`, date: addDaysISO(todayISO(), -n), outcome: "solved-clean",
  patternGuess: "correct", timeToInsightMin: 5, timeToSolveMin: 20,
  mistakeTags: [], soulStatement: "",
});

describe("which band a problem lands in", () => {
  test("test_band_neverPractised_isFreshNotNeglected", () => {
    // The bug, in one assertion.
    assert.equal(bandOf(problem([])), "fresh");
  });

  test("test_band_practisedThisWeek_isRecent", () => {
    assert.equal(bandOf(problem([practisedDaysAgo(3)])), "recent");
  });

  test("test_band_aFortnightAgo_hasBeenAFewWeeks", () => {
    assert.equal(bandOf(problem([practisedDaysAgo(14)])), "aWhile");
  });

  test("test_band_aMonthAgo_isTheOldestBand", () => {
    assert.equal(bandOf(problem([practisedDaysAgo(30)])), "longest");
  });

  test("test_band_boundariesAreInclusiveUpward", () => {
    assert.equal(bandOf(problem([practisedDaysAgo(13)])), "recent");
    assert.equal(bandOf(problem([practisedDaysAgo(29)])), "aWhile");
  });

  test("test_band_usesTheMostRecentAttempt", () => {
    // One rep last week makes it recent, however long the gap before it was.
    assert.equal(bandOf(problem([practisedDaysAgo(200), practisedDaysAgo(2)])), "recent");
  });
});

describe("the bands as a set", () => {
  test("test_bands_freshLeads", () => {
    // On a new account it is the whole list, and it is where you start.
    assert.equal(REFRESHER_BANDS[0].key, "fresh");
  });

  test("test_bands_areOrderedByHowLongItHasBeen", () => {
    assert.deepEqual(REFRESHER_BANDS.map((b) => b.key), ["fresh", "recent", "aWhile", "longest"]);
  });

  test("test_bands_freshIsNotColouredAsAProblem", () => {
    // Red on twenty-three problems you have never seen is the whole complaint.
    const fresh = REFRESHER_BANDS.find((b) => b.key === "fresh");
    assert.doesNotMatch(fresh.color, /--bad|--warn/);
  });

  test("test_bands_everyOneIsNamedWithoutADeadline", () => {
    for (const band of REFRESHER_BANDS) {
      assert.doesNotMatch(band.label, /overdue|due|late|behind/i, `"${band.label}"`);
    }
  });
});

describe("counting", () => {
  test("test_bands_countEachProblemExactlyOnce", () => {
    const problems = [
      problem([]), problem([]),
      problem([practisedDaysAgo(2)]),
      problem([practisedDaysAgo(20)]),
      problem([practisedDaysAgo(60)]),
    ];
    const bands = refresherBands(problems);
    assert.equal(bands.reduce((n, b) => n + b.count, 0), problems.length);
    assert.deepEqual(
      Object.fromEntries(bands.map((b) => [b.key, b.count])),
      { fresh: 2, recent: 1, aWhile: 1, longest: 1 },
    );
  });

  test("test_bands_aBrandNewAccount_isEntirelyFresh", () => {
    const seeded = Array.from({ length: 23 }, () => problem([]));
    const bands = refresherBands(seeded);
    assert.equal(bands.find((b) => b.key === "fresh").count, 23);
    assert.equal(bands.find((b) => b.key === "longest").count, 0);
  });

  test("test_bands_noProblems_returnsEveryBandAtZero", () => {
    // The view filters empty bands out; the count is still the full shape, so
    // a caller can't get an undefined by asking for one.
    const bands = refresherBands([]);
    assert.equal(bands.length, REFRESHER_BANDS.length);
    assert.ok(bands.every((b) => b.count === 0));
  });
});
