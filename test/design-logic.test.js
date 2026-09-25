// The system-design half of the domain (js/design-logic.js).
//
// The premise the whole file rests on: system design is part of the same
// practice day, not a separate feature. A design problem is a problem with a
// different practice format — same boxes, same intervals, same schedule — and
// the day's minutes are split between the two halves rather than duplicated.
//
// The other premise, which is what makes a bank of answers possible at all:
// there is a finite number of design decisions and their tradeoffs barely
// change, so "why Redis here" has the same answer in a rate limiter as in a
// news feed. Components are the atomic unit the way patterns are on the
// coding side.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DESIGN_PHASES, DEFAULT_DESIGN_MINUTES, DEFAULT_DESIGN_SHARE,
  designPlan, designPhase, designMinutes, splitBudget, designShare,
  componentById, componentsFor, problemsUsing, designProblemById,
  componentStats, blindSpots, designAttempts, dueDesignProblems,
  planDesignToday, recommendDesign, componentRecency, BLIND_SPOT_MIN,
} from "../js/design-logic.js";
import { COMPONENTS, CATEGORIES } from "../js/design-components.js";
import { DESIGN_PROBLEMS } from "../js/design-problems.js";
import { todayISO, addDaysISO } from "../js/logic.js";

const attempt = (over = {}) => ({
  id: "a1", date: todayISO(), covered: [], missed: [], selfScore: 3, notes: "", ...over,
});
const problem = (id, over = {}) => ({
  id, name: id, difficulty: "Medium", status: "active", box: 0,
  nextReviewDate: todayISO(), attempts: [], ...over,
});
const st = (over = {}) => ({
  settings: { dailyBudgetMin: 75, designShare: 0.4, ...over.settings },
  designProblems: over.designProblems ?? [],
});

describe("the component library is an answer bank", () => {
  test("test_design_everyComponentAnswersTheSixQuestions", () => {
    // Why this, what it costs, what else you considered, what it does badly,
    // what it forces you to plan, what they ask next. An entry missing one of
    // those is an entry that leaves you stuck in the interview.
    for (const c of COMPONENTS) {
      for (const key of ["useWhen", "limits", "planFor", "followUps"]) {
        assert.ok(Array.isArray(c[key]) && c[key].length, `${c.id} has no ${key}`);
      }
      assert.ok(c.tradeoffs?.gains?.length, `${c.id} lists no gains`);
      assert.ok(c.tradeoffs?.costs?.length, `${c.id} lists no costs`);
      assert.ok(Array.isArray(c.alternatives), `${c.id} has no alternatives`);
    }
  });

  test("test_design_everyComponentLeadsWithAPlainImage", () => {
    // Same convention as the coding topics: a concrete picture before any
    // jargon, then the same idea stated precisely.
    for (const c of COMPONENTS) {
      assert.ok(c.hook && c.hook.length > 25, `${c.id} has no hook`);
      assert.ok(c.concept && c.concept.length > 60, `${c.id} has no concept`);
    }
  });

  test("test_design_everyAlternativePointsAtARealComponent", () => {
    // A dangling "consider X instead" is a dead end in the middle of studying.
    const ids = new Set(COMPONENTS.map((c) => c.id));
    for (const c of COMPONENTS) {
      for (const alt of c.alternatives) {
        assert.ok(ids.has(alt.id), `${c.id} points at missing component ${alt.id}`);
        assert.ok(alt.insteadWhen, `${c.id} -> ${alt.id} does not say when`);
      }
    }
  });

  test("test_design_everyComponentIsInAKnownCategory", () => {
    for (const c of COMPONENTS) {
      assert.ok(CATEGORIES[c.category], `${c.id} is in unknown category ${c.category}`);
    }
  });

  test("test_design_idsAreUnique", () => {
    assert.equal(new Set(COMPONENTS.map((c) => c.id)).size, COMPONENTS.length);
  });
});

describe("the problem bank", () => {
  test("test_design_everyProblemStatesRequirementsBothWays", () => {
    // Functional and non-functional. The non-functional ones are what decide
    // the architecture, and forgetting to ask for them is the classic way this
    // interview is failed in the first five minutes.
    for (const p of DESIGN_PROBLEMS) {
      assert.ok(p.requirements?.functional?.length, `${p.id} has no functional requirements`);
      assert.ok(p.requirements?.nonFunctional?.length, `${p.id} has no non-functional requirements`);
    }
  });

  test("test_design_everyProblemCarriesAnEstimate", () => {
    for (const p of DESIGN_PROBLEMS) {
      assert.ok(p.estimate?.assumptions?.length, `${p.id} states no assumptions`);
      assert.ok(p.estimate?.derive?.length, `${p.id} derives nothing from them`);
    }
  });

  test("test_design_everyWalkthroughStageSaysWhyNotJustWhat", () => {
    // A stage that says what to build and not why is a diagram. The reason is
    // the part an interview is actually assessing.
    for (const p of DESIGN_PROBLEMS) {
      assert.ok(p.walkthrough.length >= 4, `${p.id} has only ${p.walkthrough.length} stages`);
      for (const stage of p.walkthrough) {
        assert.ok(stage.title, `${p.id} has an untitled stage`);
        assert.ok(stage.says, `${p.id}/${stage.title} says nothing`);
        assert.ok(stage.because && stage.because.length > 40,
          `${p.id}/${stage.title} does not explain itself`);
      }
    }
  });

  test("test_design_walkthroughsOnlyNameRealComponents", () => {
    const ids = new Set(COMPONENTS.map((c) => c.id));
    for (const p of DESIGN_PROBLEMS) {
      for (const stage of p.walkthrough) {
        for (const id of stage.components || []) {
          assert.ok(ids.has(id), `${p.id} names missing component ${id}`);
        }
      }
    }
  });

  test("test_design_theRubricIsAboutCoverageNotAboutMatching", () => {
    // There is more than one right design, and a bank that only rewards
    // reproducing the reference teaches the wrong thing.
    for (const p of DESIGN_PROBLEMS) {
      assert.ok(p.rubric?.length >= 5, `${p.id} has a thin rubric`);
      assert.ok(p.followUps?.length, `${p.id} has no follow-up questions`);
    }
  });

  test("test_design_componentsForListsThemInOrderWithoutRepeats", () => {
    const p = designProblemById("url-shortener");
    const list = componentsFor(p);
    assert.equal(new Set(list.map((c) => c.id)).size, list.length);
    assert.equal(list[0].id, "app-servers", "the first stage's components come first");
  });

  test("test_design_problemsUsingIsBuiltFromTheBankNotListedByHand", () => {
    // So it cannot drift when a problem is added.
    const users = problemsUsing("cache").map((p) => p.id);
    assert.ok(users.includes("url-shortener"));
    assert.ok(users.length >= 2);
  });

  test("test_design_anUnusedComponentHasNoUsers", () => {
    assert.deepEqual(problemsUsing("not-a-component"), []);
  });
});

describe("timeboxing a design session", () => {
  test("test_design_phasesFollowHowTheInterviewRuns", () => {
    assert.deepEqual(DESIGN_PHASES.map((p) => p.key),
      ["clarify", "estimate", "highlevel", "deepdive", "wrap"]);
  });

  test("test_design_theSharesSumToOne", () => {
    const total = DESIGN_PHASES.reduce((n, p) => n + p.share, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `shares sum to ${total}`);
  });

  test("test_design_everyPhaseSaysWhatToBeDoing", () => {
    for (const p of DESIGN_PHASES) assert.ok(p.prompt.length > 40, `${p.key} has no guidance`);
  });

  test("test_design_theBoxAlwaysAddsUp", () => {
    // Swept rather than spot-checked: the coding timebox had exactly this bug,
    // where rounding each phase independently left a box reporting a minute it
    // did not have.
    for (const total of [1, 10, 14, 15, 20, 30, 40, 50, 75, 120]) {
      const plan = designPlan({ settings: { designMinutes: { Unrated: total } } }, "Unrated");
      const sum = plan.phases.reduce((n, p) => n + p.minutes, 0);
      assert.equal(plan.totalMin, total, `${total}m box`);
      assert.equal(sum, total, `${total}m box: phases sum to ${sum}`);
      assert.equal(plan.phases[plan.phases.length - 1].endMin, total, `${total}m box`);
      assert.ok(plan.phases.every((p) => p.minutes >= 1), `${total}m box has an empty phase`);
    }
  });

  test("test_design_aVeryShortBoxStopsPretendingToHavePhases", () => {
    const plan = designPlan({ settings: { designMinutes: { Unrated: 10 } } }, "Unrated");
    assert.equal(plan.phases.length, 1);
  });

  test("test_design_clarifyingScalesWithDifficultyUnlikeReadingACodingProblem", () => {
    // Deliberately different from the coding timebox, where reading is a flat
    // five minutes. A harder system has more to agree about before anything can
    // be drawn.
    const clarify = (d) => designPlan({}, d).phases.find((p) => p.key === "clarify").minutes;
    assert.ok(clarify("Hard") > clarify("Easy"));
  });

  test("test_design_defaultsAreLongerThanACodingBox", () => {
    // A real design round is 45 minutes of talking and drawing; practising it
    // in fifteen teaches the wrong pace.
    assert.deepEqual(DEFAULT_DESIGN_MINUTES, { Easy: 30, Medium: 40, Hard: 50, Unrated: 40 });
  });

  test("test_design_phaseBoundariesHandOverExactlyOnce", () => {
    const plan = designPlan({}, "Medium");
    const first = plan.phases[0];
    assert.equal(designPhase(first.endMin - 0.1, plan).key, first.key);
    assert.equal(designPhase(first.endMin, plan).key, plan.phases[1].key);
  });

  test("test_design_pastTheBoxItCountsOverrunRatherThanStopping", () => {
    const plan = designPlan({}, "Medium");
    const over = designPhase(plan.totalMin + 6, plan);
    assert.equal(over.overrun, true);
    assert.equal(over.remainingMin, -6);
    assert.equal(over.key, "wrap");
  });

  test("test_design_aCustomBoxIsHonoured", () => {
    assert.equal(designMinutes({ settings: { designMinutes: { Hard: 60 } } }, "Hard"), 60);
    assert.equal(designMinutes(undefined, "Hard"), DEFAULT_DESIGN_MINUTES.Hard);
  });
});

describe("one day, split between the two halves", () => {
  test("test_design_offByDefaultSoNobodyLosesMinutesTheyDidNotGiveUp", () => {
    const split = splitBudget({ settings: { dailyBudgetMin: 75 } });
    assert.equal(split.enabled, false);
    assert.equal(split.codingMin, 75);
    assert.equal(split.designMin, 0);
  });

  test("test_design_theSplitIsTheExampleFromTheBrief", () => {
    // 45 minutes of coding complemented by 30 of design inside a 75-minute day.
    const split = splitBudget(st({ settings: { dailyBudgetMin: 75, designShare: DEFAULT_DESIGN_SHARE } }));
    assert.equal(split.codingMin, 45);
    assert.equal(split.designMin, 30);
  });

  test("test_design_theTwoHalvesAlwaysSumToTheBudget", () => {
    for (const budget of [20, 45, 60, 75, 90, 120]) {
      for (const share of [0, 0.2, 0.333, 0.4, 0.5, 1]) {
        const s = splitBudget({ settings: { dailyBudgetMin: budget, designShare: share } });
        assert.equal(s.codingMin + s.designMin, budget, `${budget}m at ${share}`);
        assert.ok(s.codingMin >= 0 && s.designMin >= 0);
      }
    }
  });

  test("test_design_aNonsenseShareIsIgnoredRatherThanApplied", () => {
    for (const bad of [-1, 2, "half", null, undefined, NaN]) {
      assert.equal(designShare({ settings: { designShare: bad } }), 0, String(bad));
    }
  });
});

describe("today's design work", () => {
  test("test_design_nothingIsPlannedWhenDesignIsOff", () => {
    const plan = planDesignToday(st({ settings: { designShare: 0 }, designProblems: [problem("a")] }));
    assert.deepEqual(plan.plan, []);
  });

  test("test_design_dueProblemsComeFirst", () => {
    const state = st({ designProblems: [
      problem("fresh", { nextReviewDate: addDaysISO(todayISO(), 10) }),
      problem("due", { attempts: [attempt()], nextReviewDate: todayISO() }),
    ] });
    assert.equal(planDesignToday(state).plan[0].problem.id, "due");
  });

  test("test_design_thePlanFitsTheDesignShareNotTheWholeBudget", () => {
    // 30 minutes of design at 40 minutes a problem is one problem, not two.
    const state = st({ designProblems: [problem("a"), problem("b"), problem("c")] });
    const plan = planDesignToday(state);
    assert.equal(plan.budgetMin, 30);
    assert.equal(plan.plan.length, 1);
    assert.equal(plan.overflow.length, 2);
  });

  test("test_design_oneProblemIsAlwaysPlannedEvenIfItExceedsTheShare", () => {
    // A budget that plans nothing is worse than one that plans one thing.
    const state = st({ settings: { dailyBudgetMin: 75, designShare: 0.1 }, designProblems: [problem("a")] });
    assert.equal(planDesignToday(state).plan.length, 1);
  });

  test("test_design_anEmptyBankPlansNothingRatherThanThrowing", () => {
    assert.deepEqual(planDesignToday(st()).plan, []);
  });
});

describe("what you reached for, and what you missed", () => {
  const worked = (covered, missed, date = todayISO()) =>
    st({ designProblems: [problem("url-shortener", {
      attempts: [attempt({ covered, missed, date })] })] });

  test("test_design_masteryIsAboutRecallNotReading", () => {
    // "Recalled" means you produced it cold, the same thing the coding side's
    // pattern recall measures.
    const stats = componentStats(worked(["cache"], ["cdn"]));
    const cache = stats.find((s) => s.component.id === "cache");
    const cdn = stats.find((s) => s.component.id === "cdn");
    assert.equal(cache.recallRate, 1);
    assert.equal(cdn.recallRate, 0);
  });

  test("test_design_aComponentYouHaveNeverMetHasNoRate", () => {
    // Not zero. Zero is a verdict; null is the absence of one.
    const stats = componentStats(worked(["cache"], []));
    assert.equal(stats.find((s) => s.component.id === "graph-db").recallRate, null);
  });

  test("test_design_everyComponentAppearsInTheTable", () => {
    assert.equal(componentStats(st()).length, COMPONENTS.length);
  });

  test("test_design_aBlindSpotNeedsToHappenTwice", () => {
    // Once is a problem you had not met. Twice is a gap.
    const once = st({ designProblems: [problem("p", { attempts: [attempt({ missed: ["cdn"] })] })] });
    assert.deepEqual(blindSpots(once), []);
    const twice = st({ designProblems: [problem("p", {
      attempts: [attempt({ id: "a1", missed: ["cdn"] }), attempt({ id: "a2", missed: ["cdn"] })] })] });
    assert.equal(blindSpots(twice)[0].component.id, "cdn");
    assert.equal(blindSpots(twice)[0].times, 2);
  });

  test("test_design_blindSpotsAreWorstFirst", () => {
    const state = st({ designProblems: [problem("p", { attempts: [
      attempt({ id: "1", missed: ["cdn", "queue"] }),
      attempt({ id: "2", missed: ["cdn", "queue"] }),
      attempt({ id: "3", missed: ["cdn"] }),
    ] })] });
    assert.deepEqual(blindSpots(state).map((b) => b.component.id), ["cdn", "queue"]);
  });

  test("test_design_theThresholdIsWhatBLIND_SPOT_MINSays", () => {
    const make = (n) => st({ designProblems: [problem("p", {
      attempts: Array.from({ length: n }, (_, i) => attempt({ id: `a${i}`, missed: ["cdn"] })) })] });
    assert.equal(blindSpots(make(BLIND_SPOT_MIN)).length, 1);
    assert.equal(blindSpots(make(BLIND_SPOT_MIN - 1)).length, 0);
  });

  test("test_design_attemptsAcrossProblemsAreOldestFirst", () => {
    const state = st({ designProblems: [
      problem("a", { attempts: [attempt({ id: "late", date: todayISO() })] }),
      problem("b", { attempts: [attempt({ id: "early", date: addDaysISO(todayISO(), -9) })] }),
    ] });
    assert.deepEqual(designAttempts(state).map((a) => a.id), ["early", "late"]);
  });

  test("test_design_recencyReadsAsNewRatherThanNeglected", () => {
    // Same framing as the refresher queue: never practised is new, not overdue.
    assert.equal(componentRecency(st(), "cache").tone, "new");
    assert.equal(componentRecency(st(), "cache").daysSince, null);
  });

  test("test_design_recencyFadesWithTime", () => {
    const old = st({ designProblems: [problem("p", { attempts: [
      attempt({ covered: ["cache"], date: addDaysISO(todayISO(), -40) })] })] });
    assert.equal(componentRecency(old, "cache").tone, "fading");
  });
});

describe("what to do next", () => {
  test("test_design_nothingIsRecommendedWhenDesignIsOff", () => {
    assert.equal(recommendDesign(st({ settings: { designShare: 0 }, designProblems: [problem("a")] })), null);
  });

  test("test_design_nothingIsRecommendedOnceYouHaveDoneOneToday", () => {
    // The coding half owns the dashboard's headline; two recommendations is two
    // people telling you what to do.
    const state = st({ designProblems: [problem("a", { attempts: [attempt()] })] });
    assert.equal(recommendDesign(state), null);
  });

  test("test_design_aBlindSpotOutranksAMerelyDueProblem", () => {
    const state = st({ designProblems: [
      problem("url-shortener", { attempts: [
        attempt({ id: "1", date: addDaysISO(todayISO(), -9), missed: ["cdn"] }),
        attempt({ id: "2", date: addDaysISO(todayISO(), -8), missed: ["cdn"] }),
      ] }),
    ] });
    const rec = recommendDesign(state);
    assert.equal(rec.type, "blind-spot");
    assert.equal(rec.componentId, "cdn");
  });

  test("test_design_anUntouchedProblemIsRecommendedBeforeNothing", () => {
    const rec = recommendDesign(st({ designProblems: [problem("url-shortener")] }));
    assert.equal(rec.type, "first");
  });

  test("test_design_anEmptyBankRecommendsNothingRatherThanThrowing", () => {
    assert.equal(recommendDesign(st()), null);
  });
});

describe("design problems are scheduled like any other problem", () => {
  test("test_design_dueMeansTodayOrEarlier", () => {
    const state = st({ designProblems: [
      problem("due", { nextReviewDate: addDaysISO(todayISO(), -1) }),
      problem("later", { nextReviewDate: addDaysISO(todayISO(), 3) }),
    ] });
    assert.deepEqual(dueDesignProblems(state).map((p) => p.id), ["due"]);
  });

  test("test_design_theLowestBoxComesFirst", () => {
    const state = st({ designProblems: [
      problem("settled", { box: 4 }), problem("shaky", { box: 0 }),
    ] });
    assert.deepEqual(dueDesignProblems(state).map((p) => p.id), ["shaky", "settled"]);
  });
});
