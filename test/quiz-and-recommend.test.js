// Tests for the recall drill and the deeper branches of the session
// recommender — the parts of js/logic.js that decide what the app puts in
// front of you next.
//
// Both involve randomness, which is exactly why they need pinning: a quiz that
// can offer the right answer twice, or omit it entirely, silently stops being a
// test of anything.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  uid, pickQuizProblem, quizOptions, recommendSession, todayISO, addDaysISO,
  STATUS_ACTIVE, STATUS_BACKLOG,
} from "../js/logic.js";

const PATTERNS = [
  { id: "two-pointers", name: "Two Pointers", description: "" },
  { id: "trees", name: "Trees", description: "" },
  { id: "greedy", name: "Greedy", description: "" },
  { id: "heap", name: "Heap", description: "" },
  { id: "intervals", name: "Intervals", description: "" },
];

function makeProblem(over = {}) {
  return {
    id: over.id || uid(),
    name: "Problem",
    number: 1,
    difficulty: "Medium",
    patternId: "two-pointers",
    status: STATUS_ACTIVE,
    box: 0,
    nextReviewDate: todayISO(),
    attempts: [],
    ...over,
  };
}

function makeAttempt(over = {}) {
  return {
    id: uid(), date: todayISO(), outcome: "solved-clean", patternGuess: "correct",
    timeToInsightMin: 5, timeToSolveMin: 20, mistakeTags: [], soulStatement: "",
    ...over,
  };
}

function makeState(over = {}) {
  return {
    meta: { schemaVersion: 4 },
    settings: {
      dailyBudgetMin: 75,
      boxIntervalsDays: [0, 1, 3, 7, 16, 35],
      estimateMinByDifficulty: { Easy: 20, Medium: 30, Hard: 45, Unrated: 30 },
      systemDesignUnlockThreshold: { minMocks: 10, minSolvedCleanRate: 0.7 },
    },
    patterns: PATTERNS,
    problems: [],
    mocks: [], journal: [],
    systemDesign: { manualUnlock: false, sessions: [] },
    streak: { current: 0, longest: 0, lastActiveDate: null },
    resources: {}, whiteboards: [],
    quiz: { totalAsked: 0, totalCorrect: 0, recent: [] },
    ...over,
  };
}

describe("uid", () => {
  test("test_uid_manyCalls_neverCollides", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => uid()));
    assert.equal(ids.size, 5000, "a collision would silently merge two problems");
  });
});

describe("pickQuizProblem", () => {
  test("test_pickQuizProblem_noAttemptedProblems_returnsNull", () => {
    // The drill asks "what pattern is this?" about problems you've actually
    // seen; with none, there is nothing honest to ask.
    assert.equal(pickQuizProblem(makeState({ problems: [makeProblem()] })), null);
  });

  test("test_pickQuizProblem_attemptedProblem_isEligible", () => {
    const state = makeState({ problems: [makeProblem({ attempts: [makeAttempt()] })] });
    assert.ok(pickQuizProblem(state));
  });

  test("test_pickQuizProblem_excludedIds_areSkippedWhenAlternativesExist", () => {
    // Stops the drill asking the same question twice in a row.
    const problems = [
      makeProblem({ id: "seen", attempts: [makeAttempt()] }),
      makeProblem({ id: "other", attempts: [makeAttempt()] }),
    ];
    assert.equal(pickQuizProblem(makeState({ problems }), ["seen"]).id, "other");
  });

  test("test_pickQuizProblem_everythingExcluded_cyclesRatherThanGivingUp", () => {
    // Deliberate: once you've been asked about everything you've attempted,
    // repeating a question is more useful than an empty drill. Pinned because
    // it reads like an oversight and isn't.
    const problems = [
      makeProblem({ id: "a", attempts: [makeAttempt()] }),
      makeProblem({ id: "b", attempts: [makeAttempt()] }),
    ];
    const picked = pickQuizProblem(makeState({ problems }), ["a", "b"]);
    assert.ok(picked && ["a", "b"].includes(picked.id));
  });

  test("test_pickQuizProblem_repeatedCalls_doNotAlwaysReturnTheSameProblem", () => {
    const problems = Array.from({ length: 8 }, (_, i) =>
      makeProblem({ id: `p${i}`, attempts: [makeAttempt()] }));
    const state = makeState({ problems });
    const seen = new Set(Array.from({ length: 60 }, () => pickQuizProblem(state)?.id));
    assert.ok(seen.size > 1, "a drill that always asks about the same problem teaches nothing");
  });
});

describe("quizOptions", () => {
  test("test_quizOptions_alwaysIncludeTheCorrectAnswer", () => {
    // Without this the drill is unanswerable, and every answer scores wrong.
    for (let i = 0; i < 100; i++) {
      assert.ok(quizOptions(makeState(), "trees", 4).includes("trees"));
    }
  });

  test("test_quizOptions_containNoDuplicates", () => {
    for (let i = 0; i < 100; i++) {
      const opts = quizOptions(makeState(), "trees", 4);
      assert.equal(new Set(opts).size, opts.length);
    }
  });

  test("test_quizOptions_returnsRequestedCountWhenEnoughPatternsExist", () => {
    assert.equal(quizOptions(makeState(), "trees", 4).length, 4);
  });

  test("test_quizOptions_fewerPatternsThanRequested_returnsWhatExists", () => {
    const state = makeState({ patterns: PATTERNS.slice(0, 2) });
    const opts = quizOptions(state, "trees", 4);
    assert.equal(opts.length, 2);
    assert.ok(opts.includes("trees"));
  });

  test("test_quizOptions_orderVaries_soPositionIsNotTheAnswer", () => {
    const state = makeState();
    const positions = new Set(
      Array.from({ length: 80 }, () => quizOptions(state, "trees", 4).indexOf("trees")));
    assert.ok(positions.size > 1, "a fixed slot would let you answer by position instead of recall");
  });

  test("test_quizOptions_everyOptionIsARealPattern", () => {
    const ids = new Set(PATTERNS.map((p) => p.id));
    for (const id of quizOptions(makeState(), "trees", 4)) assert.ok(ids.has(id));
  });
});

describe("recommendSession — deeper branches", () => {
  test("test_recommendSession_repeatedFailuresOnAPattern_recommendsADeepDive", () => {
    // Drilling more reps on a pattern you keep failing is the wrong advice;
    // the app should send you back to the technique first.
    const weak = Array.from({ length: 3 }, () =>
      makeProblem({ patternId: "greedy", attempts: [makeAttempt({ outcome: "failed" })] }));
    const state = makeState({ problems: weak });
    const rec = recommendSession(state);
    assert.equal(rec.type, "deep-dive");
    assert.equal(rec.patternId, "greedy");
    assert.match(rec.message, /clean-solve/);
  });

  test("test_recommendSession_patternUntouchedForWeeks_nudgesBeforeItFades", () => {
    const stale = makeProblem({
      patternId: "trees",
      nextReviewDate: addDaysISO(todayISO(), 60),
      attempts: [makeAttempt({ date: addDaysISO(todayISO(), -40), outcome: "solved-clean" })],
    });
    const today = makeProblem({
      patternId: "two-pointers",
      nextReviewDate: addDaysISO(todayISO(), 60),
      attempts: [makeAttempt({ outcome: "solved-clean" })],
    });
    const rec = recommendSession(makeState({ problems: [stale, today] }));
    assert.equal(rec.type, "stale-nudge");
    assert.equal(rec.patternId, "trees");
  });

  test("test_recommendSession_freshVolume_prefersAnUntouchedPatternOverAPracticedOne", () => {
    // Nothing practiced today and nothing due: a genuinely open day, so the
    // bank should name the pattern with the biggest gap.
    const practiced = makeProblem({
      patternId: "two-pointers",
      nextReviewDate: addDaysISO(todayISO(), 30),
      attempts: [makeAttempt({ date: addDaysISO(todayISO(), -5), outcome: "solved-clean" })],
    });
    const bankedNew = makeProblem({ id: "new", patternId: "heap", status: STATUS_BACKLOG, nextReviewDate: null });
    const bankedKnown = makeProblem({ id: "known", patternId: "two-pointers", status: STATUS_BACKLOG, nextReviewDate: null });
    const rec = recommendSession(makeState({ problems: [practiced, bankedKnown, bankedNew] }));
    assert.equal(rec.type, "fresh-volume");
    assert.equal(rec.problem.patternId, "heap", "a never-attempted pattern is the bigger gap");
  });

  test("test_recommendSession_alreadyPracticedAndQueueClear_saysStopRatherThanOfferingTheBank", () => {
    // The bank is offered on an open day, never as a way to keep going after
    // the day's work is done. Pinning this because "we have 500 problems
    // sitting right there" is a very easy argument to make, and taking it
    // would turn the anti-burnout stopping point into an endless feed.
    const state = makeState({
      problems: [
        makeProblem({
          nextReviewDate: addDaysISO(todayISO(), 30),
          attempts: [makeAttempt({ date: todayISO(), outcome: "solved-clean" })],
        }),
        makeProblem({ id: "banked", status: STATUS_BACKLOG, nextReviewDate: null, patternId: "heap" }),
      ],
    });
    const rec = recommendSession(state);
    assert.equal(rec.type, "none");
    assert.match(rec.message, /stopping point/);
  });

  test("test_recommendSession_alreadyPracticedToday_doesNotOpenWithFirstRep", () => {
    const state = makeState({
      problems: [makeProblem({ attempts: [makeAttempt({ date: todayISO() })] })],
    });
    assert.notEqual(recommendSession(state).type, "first-rep");
  });

  test("test_recommendSession_everyBranch_returnsAProblemOrExplainsWhyNot", () => {
    const cases = [
      makeState(),
      makeState({ problems: [makeProblem()] }),
      makeState({ problems: [makeProblem({ status: STATUS_BACKLOG, nextReviewDate: null })] }),
      makeState({ problems: [makeProblem({ attempts: [makeAttempt({ outcome: "failed" })] })] }),
    ];
    for (const state of cases) {
      const rec = recommendSession(state);
      assert.ok(rec.type && rec.message, "a recommendation must always be explainable");
      if (rec.type !== "none") assert.ok(rec.problem, `${rec.type} promised work but named none`);
    }
  });
});
