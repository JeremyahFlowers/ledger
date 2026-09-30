// Two mediums in forty-five minutes (js/pair-mock.js).
//
// The skill is not solving a medium; it is solving one in twenty minutes and
// then another. These pin the round: which two problems, what the second is
// given after the first, the phases at that pace, and the verdict — said in
// words, because "met", "close" and "missed" are different debriefs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  PAIR_MINUTES, MIN_SECOND_MIN, pickPair, pairPlan,
  startPair, pairIsCurrent, pairFinished, usedMinutes, budgetFor, recordPairStep,
  pairVerdict, recordPairMock, pairHistory, pairMocksToday, PAIR_MEMORY,
} from "../js/pair-mock.js";

const TODAY = "2026-09-29";

const problem = (id, patternId, difficulty = "Medium", attempts = []) =>
  ({ id, patternId, difficulty, attempts });

function makeSubject(problems) {
  return { problems, pairMocks: [] };
}

describe("choosing the pair", () => {
  test("test_pair_picksTwoMediums", () => {
    const pair = pickPair(makeSubject([problem("a", "x"), problem("b", "y"), problem("c", "z", "Hard")]), TODAY);
    assert.equal(pair.length, 2);
    assert.ok(pair.every((p) => p.difficulty === "Medium"));
  });

  test("test_pair_twoDifferentPatternsWhenThereAreTwo", () => {
    // Two of the same pattern is one pattern practised twice.
    const pair = pickPair(makeSubject([problem("a", "x"), problem("b", "x"), problem("c", "y")]), TODAY);
    assert.notEqual(pair[0].patternId, pair[1].patternId);
  });

  test("test_pair_samePatternOnlyIfThereIsNoOther", () => {
    const pair = pickPair(makeSubject([problem("a", "x"), problem("b", "x")]), TODAY);
    assert.notEqual(pair[0].id, pair[1].id);
  });

  test("test_pair_unattemptedBeforeRecentlySolved", () => {
    // A problem solved on Tuesday is a memory test on Wednesday.
    const pair = pickPair(makeSubject([
      problem("seen", "x", "Medium", [{ date: "2026-09-28" }]),
      problem("fresh1", "y"), problem("fresh2", "z"),
    ]), TODAY);
    assert.ok(!pair.some((p) => p.id === "seen"));
  });

  test("test_pair_isStableThroughTheDay", () => {
    const s = makeSubject(["a", "b", "c", "d", "e"].map((id, i) => problem(id, `p${i}`)));
    assert.deepEqual(pickPair(s, TODAY).map((p) => p.id), pickPair(s, TODAY).map((p) => p.id));
  });

  test("test_pair_fewerThanTwoMediumsIsNoPair", () => {
    assert.equal(pickPair(makeSubject([problem("a", "x")]), TODAY), null);
    assert.equal(pickPair({}, TODAY), null);
  });
});

describe("the phases at this pace", () => {
  test("test_pair_planAddsUpToItsBudget", () => {
    for (const m of [8, 10, 15, 22, 30, 45]) {
      const plan = pairPlan(m);
      assert.equal(plan.phases.reduce((n, p) => n + p.minutes, 0), m, `${m}m`);
      assert.equal(plan.totalMin, m);
    }
  });

  test("test_pair_clarifyingIsShortAtThisPace", () => {
    // Two questions, not ten.
    const plan = pairPlan(22);
    assert.ok(plan.phases[0].key === "clarify" && plan.phases[0].minutes <= 3);
  });

  test("test_pair_codingGetsMostOfIt", () => {
    const plan = pairPlan(22);
    const code = plan.phases.find((p) => p.key === "code");
    assert.ok(code.minutes > 22 / 2);
  });

  test("test_pair_aTinyBudgetIsOnePhase", () => {
    assert.equal(pairPlan(5).phases.length, 1);
  });
});

describe("a round in progress", () => {
  const run = () => startPair([problem("a", "x"), problem("b", "y")], TODAY);

  test("test_pair_theFirstProblemGetsTheWholeRound", () => {
    assert.equal(budgetFor(run()).minutes, PAIR_MINUTES);
  });

  test("test_pair_theSecondGetsWhatIsLeft", () => {
    const r = recordPairStep(run(), { problemId: "a", workMin: 19, outcome: "solved-clean" });
    assert.equal(budgetFor(r).minutes, PAIR_MINUTES - 19);
    assert.equal(budgetFor(r).short, false);
  });

  test("test_pair_aFirstThatOverranStillLeavesTheSecondSomething", () => {
    // Practice at an impossible box teaches nothing; the verdict records the loss.
    const r = recordPairStep(run(), { problemId: "a", workMin: 44, outcome: "solved-struggled" });
    assert.equal(budgetFor(r).minutes, MIN_SECOND_MIN);
    assert.equal(budgetFor(r).short, true);
  });

  test("test_pair_twoResultsFinishIt", () => {
    let r = recordPairStep(run(), { problemId: "a", workMin: 20, outcome: "solved-clean" });
    assert.equal(pairFinished(r), false);
    r = recordPairStep(r, { problemId: "b", workMin: 20, outcome: "solved-clean" });
    assert.equal(pairFinished(r), true);
    assert.equal(usedMinutes(r), 40);
  });

  test("test_pair_aThirdResultIsIgnored", () => {
    let r = run();
    for (let i = 0; i < 3; i++) r = recordPairStep(r, { problemId: "a", workMin: 10, outcome: "solved-clean" });
    assert.equal(r.results.length, 2);
  });

  test("test_pair_yesterdaysRoundIsNotTodays", () => {
    assert.equal(pairIsCurrent(startPair([problem("a", "x"), problem("b", "y")], "2026-09-28"), TODAY), false);
    assert.equal(pairIsCurrent(run(), TODAY), true);
    assert.equal(pairIsCurrent(null, TODAY), false);
  });
});

describe("the verdict", () => {
  const finished = (a, b) => {
    let r = startPair([problem("a", "x"), problem("b", "y")], TODAY);
    r = recordPairStep(r, { problemId: "a", ...a });
    return recordPairStep(r, { problemId: "b", ...b });
  };

  test("test_pair_bothSolvedInTimeMeetsTheBar", () => {
    assert.equal(pairVerdict(finished({ workMin: 20, outcome: "solved-clean" }, { workMin: 22, outcome: "solved-struggled" })).bar, "met");
  });

  test("test_pair_bothSolvedButOverIsClose", () => {
    const v = pairVerdict(finished({ workMin: 30, outcome: "solved-clean" }, { workMin: 25, outcome: "solved-clean" }));
    assert.equal(v.bar, "close");
    assert.match(v.message, /10 over/);
  });

  test("test_pair_oneSolvedInTimeIsClose", () => {
    assert.equal(pairVerdict(finished({ workMin: 20, outcome: "solved-clean" }, { workMin: 20, outcome: "failed" })).bar, "close");
  });

  test("test_pair_neitherIsMissed", () => {
    assert.equal(pairVerdict(finished({ workMin: 20, outcome: "failed" }, { workMin: 20, outcome: "ran-out-of-time" })).bar, "missed");
  });

  test("test_pair_exactlyFortyFiveIsInTime", () => {
    assert.equal(pairVerdict(finished({ workMin: 20, outcome: "solved-clean" }, { workMin: 25, outcome: "solved-clean" })).bar, "met");
  });

  test("test_pair_everyVerdictSaysWhy", () => {
    for (const [a, b] of [["solved-clean", "solved-clean"], ["solved-clean", "failed"], ["failed", "failed"]]) {
      const v = pairVerdict(finished({ workMin: 20, outcome: a }, { workMin: 30, outcome: b }));
      assert.ok(v.message.length > 30);
    }
  });
});

describe("keeping the rounds", () => {
  const finishedRun = (date = TODAY) => {
    let r = startPair([problem("a", "x"), problem("b", "y")], date);
    r = recordPairStep(r, { problemId: "a", workMin: 20, outcome: "solved-clean" });
    return recordPairStep(r, { problemId: "b", workMin: 20, outcome: "solved-clean" });
  };

  test("test_pair_aFinishedRoundIsLogged", () => {
    const s = { pairMocks: [] };
    recordPairMock(s, finishedRun());
    assert.equal(s.pairMocks.length, 1);
    assert.equal(s.pairMocks[0].bar, "met");
  });

  test("test_pair_anUnfinishedRoundIsNot", () => {
    const s = { pairMocks: [] };
    recordPairMock(s, startPair([problem("a", "x"), problem("b", "y")], TODAY));
    assert.equal(s.pairMocks.length, 0);
  });

  test("test_pair_recordingTheSameRoundTwiceKeepsOne", () => {
    const s = { pairMocks: [] };
    const r = finishedRun();
    recordPairMock(s, r);
    recordPairMock(s, r);
    assert.equal(s.pairMocks.length, 1);
  });

  test("test_pair_theLogIsBounded", () => {
    const s = { pairMocks: [] };
    for (let i = 0; i < PAIR_MEMORY + 5; i++) recordPairMock(s, finishedRun());
    assert.equal(s.pairMocks.length, PAIR_MEMORY);
  });

  test("test_pair_historyCountsTheLastMonth", () => {
    const s = { pairMocks: [] };
    recordPairMock(s, finishedRun("2026-08-01"));
    recordPairMock(s, finishedRun(TODAY));
    assert.deepEqual(pairHistory(s, TODAY), { rounds: 1, met: 1 });
    assert.equal(pairMocksToday(s, TODAY), 1);
  });
});

describe("a reload in the middle of a round", () => {
  test("test_pair_theSessionSnapshotKeepsWhichHalfItIs", async () => {
    // Without it a reload mid-round came back as an ordinary mock with a
    // 45-minute clock, and saving it never handed back to the round.
    const { snapshotOf } = await import("../js/session-store.js");
    const pair = { runId: "r1", index: 1, budgetMin: 24 };
    const snap = snapshotOf({ problem: { id: "p" }, isMock: true, pair, checklist: {} });
    assert.deepEqual(snap.pair, pair);
  });

  test("test_pair_anOrdinarySessionSnapshotHasNoPair", async () => {
    const { snapshotOf } = await import("../js/session-store.js");
    assert.equal(snapshotOf({ problem: { id: "p" }, checklist: {} }).pair, null);
  });
});
