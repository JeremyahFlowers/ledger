// Timeboxing one question (js/logic.js).
//
// The daily budget was a ceiling for the day and said nothing about one
// problem, so a single medium could absorb all seventy-five minutes — which is
// not how the thing being practised works. An interview gives you forty-five
// minutes and takes the laptop away, and part of the skill is deciding, inside
// that box, when to stop planning and start typing.
//
// The division is deliberately not proportional. Understanding a problem takes
// about five minutes whether it is easy or hard; what scales with difficulty is
// how long you should be willing to plan before committing to code.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  questionPlan, questionPhase, questionMinutes, planMinutes,
  DEFAULT_QUESTION_MINUTES, DEFAULT_PLAN_MINUTES, READ_MINUTES, REFLECT_MINUTES,
  phaseLayout, PHASE_LAYOUTS,
} from "../js/logic.js";

const boxed = (min, plan) => ({
  settings: { questionMinutes: { Unrated: min }, planMinutes: { Unrated: plan ?? 15 } },
});
const phaseMap = (p) => Object.fromEntries(p.phases.map((x) => [x.key, [x.startMin, x.endMin]]));

describe("the default boxes", () => {
  test("test_timebox_defaultsAreOneBoxPerDifficulty", () => {
    assert.deepEqual(DEFAULT_QUESTION_MINUTES, { Easy: 30, Medium: 45, Hard: 60, Unrated: 45 });
  });

  test("test_timebox_mediumSplitsFiveFifteenTwentyFive", () => {
    assert.deepEqual(phaseMap(questionPlan({}, "Medium")),
      { read: [0, 5], plan: [5, 20], code: [20, 40], reflect: [40, 45] });
  });

  test("test_timebox_readingDoesNotScaleWithDifficulty", () => {
    // A hard problem is not harder to read. It is harder to solve.
    for (const d of ["Easy", "Medium", "Hard"]) {
      assert.equal(phaseMap(questionPlan({}, d)).read[1], READ_MINUTES, d);
    }
  });

  test("test_timebox_planningScalesWithDifficulty", () => {
    const plan = (d) => { const [a, b] = phaseMap(questionPlan({}, d)).plan; return b - a; };
    assert.ok(plan("Easy") < plan("Medium"));
    assert.ok(plan("Medium") < plan("Hard"));
  });

  test("test_timebox_reflectionIsReservedNotHoped_for", () => {
    // It is the part this whole app exists to collect, and the first thing to
    // get squeezed out when the clock runs down.
    for (const d of ["Easy", "Medium", "Hard"]) {
      const m = phaseMap(questionPlan({}, d));
      assert.equal(m.reflect[1] - m.reflect[0], REFLECT_MINUTES, d);
      assert.equal(m.reflect[1], questionMinutes({}, d), `${d}: reflect must end the box`);
    }
  });

  test("test_timebox_phasesAreContiguousAndCoverTheBox", () => {
    for (const d of ["Easy", "Medium", "Hard", "Unrated"]) {
      const { phases, totalMin } = questionPlan({}, d);
      assert.equal(phases[0].startMin, 0);
      assert.equal(phases[phases.length - 1].endMin, totalMin, d);
      for (let i = 1; i < phases.length; i++) {
        assert.equal(phases[i].startMin, phases[i - 1].endMin, `${d}: gap before ${phases[i].key}`);
      }
    }
  });

  test("test_timebox_codeGetsAtLeastAsLongAsPlanning", () => {
    // A box that leaves less time to write the solution than to design it is
    // not teaching the right lesson.
    for (const d of ["Easy", "Medium", "Hard"]) {
      const m = phaseMap(questionPlan({}, d));
      assert.ok((m.code[1] - m.code[0]) >= (m.plan[1] - m.plan[0]), d);
    }
  });
});

describe("boxes the defaults don't fit into", () => {
  test("test_timebox_aShortBox_shrinksRatherThanGoingNegative", () => {
    const { phases, totalMin } = questionPlan(boxed(15), "Unrated");
    assert.equal(totalMin, 15);
    assert.ok(phases.every((p) => p.minutes >= 1), "a phase with no minutes in it");
    assert.equal(phases[phases.length - 1].endMin, 15);
  });

  test("test_timebox_aShortBox_keepsTheSameShape", () => {
    // A fifteen-minute warm-up should be a small version of the process, not a
    // different one.
    assert.deepEqual(questionPlan(boxed(15), "Unrated").phases.map((p) => p.key),
      ["read", "plan", "code", "reflect"]);
  });

  test("test_timebox_aVeryShortBox_stopsPretendingToHavePhases", () => {
    // Eight minutes divided four ways is four two-minute phases, which is
    // ceremony rather than guidance.
    const { phases } = questionPlan(boxed(8), "Unrated");
    assert.equal(phases.length, 1);
    assert.equal(phases[0].key, "solve");
  });

  test("test_timebox_aOneMinuteBox_doesNotThrowOrGoNegative", () => {
    const { phases, totalMin } = questionPlan(boxed(1), "Unrated");
    assert.equal(totalMin, 1);
    assert.ok(phases.every((p) => p.minutes > 0));
  });

  test("test_timebox_aHugeBox_stillReservesOnlyWhatItNeeds", () => {
    const m = phaseMap(questionPlan(boxed(180, 25), "Unrated"));
    assert.equal(m.read[1] - m.read[0], READ_MINUTES);
    assert.equal(m.plan[1] - m.plan[0], 25);
    assert.ok(m.code[1] - m.code[0] > 100, "the extra time should go to writing it");
  });
});

describe("the box always adds up", () => {
  test("test_timebox_everyBoxSumsToItselfExactly", () => {
    // An earlier version scaled the fixed phases and let code take the
    // remainder, and rounding pushed the last boundary *past* the box — a
    // 15-minute box reporting itself as 16, which means a timer that ends
    // before the plan says it should. Swept rather than spot-checked, because
    // the failure only appeared at particular combinations.
    for (const total of [1, 5, 8, 12, 13, 15, 20, 25, 30, 45, 60, 75, 180]) {
      for (const planning of [1, 5, 10, 15, 25, 30, 60]) {
        const p = questionPlan(boxed(total, planning), "Unrated");
        const sum = p.phases.reduce((n, x) => n + x.minutes, 0);
        const label = `${total}m box, ${planning}m planning`;
        assert.equal(p.totalMin, total, label);
        assert.equal(sum, total, `${label}: phases sum to ${sum}`);
        assert.equal(p.phases[p.phases.length - 1].endMin, total, label);
        assert.ok(p.phases.every((x) => x.minutes >= 1), `${label}: a phase with no minutes`);
      }
    }
  });

  test("test_timebox_codeBorrowsFromPlanningFirst", () => {
    // Planning is the elastic phase: you can settle on an approach in less time
    // than you would like, but you cannot read the problem in no time and you
    // cannot write down what happened in no time.
    const m = phaseMap(questionPlan(boxed(14, 25), "Unrated"));
    assert.equal(m.read[1] - m.read[0], READ_MINUTES);
    assert.equal(m.reflect[1] - m.reflect[0], REFLECT_MINUTES);
    assert.ok(m.code[1] - m.code[0] >= 1);
  });
});

describe("settings override the defaults", () => {
  test("test_timebox_customBoxIsHonoured", () => {
    assert.equal(questionMinutes(boxed(50), "Unrated"), 50);
    assert.equal(questionPlan(boxed(50), "Unrated").totalMin, 50);
  });

  test("test_timebox_customPlanningTimeIsHonoured", () => {
    assert.equal(planMinutes(boxed(60, 30), "Unrated"), 30);
    const m = phaseMap(questionPlan(boxed(60, 30), "Unrated"));
    assert.equal(m.plan[1] - m.plan[0], 30);
  });

  test("test_timebox_anUnknownDifficultyFallsBackToUnrated", () => {
    assert.equal(questionMinutes({}, "Legendary"), DEFAULT_QUESTION_MINUTES.Unrated);
    assert.equal(planMinutes({}, "Legendary"), DEFAULT_PLAN_MINUTES.Unrated);
  });

  test("test_timebox_missingSettingsUseTheDefaults", () => {
    assert.equal(questionMinutes(undefined, "Hard"), DEFAULT_QUESTION_MINUTES.Hard);
    assert.equal(questionMinutes({ settings: {} }, "Hard"), DEFAULT_QUESTION_MINUTES.Hard);
  });
});

describe("where you are in the box", () => {
  const plan = questionPlan({}, "Medium");   // 5 / 15 / 20 / 5

  test("test_phase_atTheStart_isReading", () => {
    assert.equal(questionPhase(0, plan).key, "read");
  });

  test("test_phase_eachBoundaryHandsOverExactlyOnce", () => {
    assert.equal(questionPhase(4.9, plan).key, "read");
    assert.equal(questionPhase(5, plan).key, "plan");
    assert.equal(questionPhase(20, plan).key, "code");
    assert.equal(questionPhase(40, plan).key, "reflect");
  });

  test("test_phase_saysWhatComesNext", () => {
    assert.equal(questionPhase(3, plan).nextLabel, "Plan");
    assert.equal(questionPhase(41, plan).nextLabel, null, "nothing follows the last phase");
  });

  test("test_phase_warnsBeforeTheBoundaryNotAtIt", () => {
    // A nudge that lands exactly as the phase ends is a nudge you cannot act on.
    assert.equal(questionPhase(4.5, plan).endingSoon, true);
    assert.equal(questionPhase(2, plan).endingSoon, false);
  });

  test("test_phase_pastTheBox_countsOverrunRatherThanStopping", () => {
    // An app that quietly stops counting teaches the opposite of the lesson.
    const over = questionPhase(52, plan);
    assert.equal(over.overrun, true);
    assert.equal(over.remainingMin, -7);
    assert.equal(over.key, "reflect", "it stays in the last phase rather than becoming undefined");
  });

  test("test_phase_remainingInPhase_isAboutThePhaseNotTheBox", () => {
    const p = questionPhase(10, plan);
    assert.equal(p.remainingInPhase, 10);
    assert.equal(p.remainingMin, 35);
  });

  test("test_phase_carriesThePromptForWhatToBeDoing", () => {
    for (const at of [0, 10, 30, 42]) {
      assert.ok(questionPhase(at, plan).prompt.length > 20, `no guidance at ${at} min`);
    }
  });
});

describe("settings the app writes and reads back", () => {
  test("test_timebox_aNewLogGetsTheDefaults", async () => {
    const { buildSeedState } = await import("../js/seed.js");
    const s = buildSeedState();
    assert.deepEqual(s.settings.questionMinutes, DEFAULT_QUESTION_MINUTES);
    assert.deepEqual(s.settings.planMinutes, DEFAULT_PLAN_MINUTES);
  });

  test("test_timebox_anOlderLogIsBackfilled", async () => {
    // Every log written before this shipped has no box, and reading the table
    // at render time only would leave the Settings inputs empty.
    const { migrateState } = await import("../js/seed.js");
    const s = migrateState({ settings: { dailyBudgetMin: 75 }, problems: [], patterns: [] });
    assert.deepEqual(s.settings.questionMinutes, DEFAULT_QUESTION_MINUTES);
  });

  test("test_timebox_aLogWithNoSettingsAtAll_doesNotThrow", () => {
    // migrateState runs on whatever GitHub returns, and had always assumed a
    // settings object existed. The first line to reach into it found one that
    // didn't.
    return import("../js/seed.js").then(({ migrateState }) => {
      assert.doesNotThrow(() => migrateState({ problems: [], patterns: [] }));
    });
  });

  test("test_timebox_aSavedBoxSurvivesMigration", () => {
    return import("../js/seed.js").then(({ migrateState }) => {
      const s = migrateState({
        settings: { questionMinutes: { Easy: 20, Medium: 40, Hard: 55, Unrated: 40 } },
        problems: [], patterns: [],
      });
      assert.equal(s.settings.questionMinutes.Medium, 40, "a user's own setting was overwritten");
    });
  });
});

describe("the layout follows the interview, not the editor", () => {
  // How a real interview goes: you read the problem, you diagram the approach
  // while the interviewer watches you think, and *then* you write code — with
  // the diagram still on screen, because the reason you drew it was to code
  // against it. A code editor that dominates from the first second teaches the
  // opposite: start typing, work it out as you go.

  const [STATEMENT, CODE, BOARD] = [0, 1, 2];

  test("test_layout_everyPhaseSumsToOne", () => {
    for (const [key, l] of Object.entries(PHASE_LAYOUTS)) {
      assert.equal(l.length, 3, key);
      assert.ok(Math.abs(l.reduce((a, b) => a + b, 0) - 1) < 1e-9, `${key} sums to ${l.reduce((a, b) => a + b, 0)}`);
    }
  });

  test("test_layout_readingLeadsWithTheProblem", () => {
    const l = phaseLayout("read");
    assert.ok(l[STATEMENT] > l[CODE] && l[STATEMENT] > l[BOARD]);
  });

  test("test_layout_planningLeadsWithTheWhiteboard", () => {
    const l = phaseLayout("plan");
    assert.ok(l[BOARD] > l[CODE] && l[BOARD] > l[STATEMENT]);
  });

  test("test_layout_codingLeadsWithTheEditor", () => {
    const l = phaseLayout("code");
    assert.ok(l[CODE] > l[BOARD] && l[CODE] > l[STATEMENT]);
  });

  test("test_layout_theBoardStaysVisibleWhileCoding", () => {
    // The stated reason for drawing it: reference the diagram while writing the
    // solution. Shrinking it to a sliver, or closing it, defeats that.
    const l = phaseLayout("code");
    assert.ok(l[BOARD] >= 0.2, `board is ${l[BOARD]} of the window while coding`);
  });

  test("test_layout_theBoardGetsMoreRoomWhilePlanningThanWhileCoding", () => {
    assert.ok(phaseLayout("plan")[BOARD] > phaseLayout("code")[BOARD]);
  });

  test("test_layout_theEditorIsNotDominantBeforeItIsTimeToCode", () => {
    // Teaching "start typing before you know the shape of the answer" is the
    // single most common way a solvable interview problem goes wrong.
    for (const phase of ["read", "plan"]) {
      const l = phaseLayout(phase);
      assert.ok(l[CODE] < l[STATEMENT] + l[BOARD], `${phase} gives the editor the room`);
    }
  });

  test("test_layout_noPaneIsEverCollapsedEntirely", () => {
    for (const [key, l] of Object.entries(PHASE_LAYOUTS)) {
      assert.ok(l.every((f) => f >= 0.1), `${key} collapses a pane to ${Math.min(...l)}`);
    }
  });

  test("test_layout_anUnknownPhaseFallsBackRatherThanReturningUndefined", () => {
    assert.deepEqual(phaseLayout("nonsense"), PHASE_LAYOUTS.solve);
    assert.deepEqual(phaseLayout(undefined), PHASE_LAYOUTS.solve);
  });
});

describe("the layout defers to you", () => {
  const src = readFileSync(fileURLToPath(new URL("../js/session-view.js", import.meta.url)), "utf8");

  test("test_layout_aDragStopsTheAppMovingPanes", () => {
    // For the rest of the session, not the rest of the phase. A layout that
    // reasserts itself over a deliberate adjustment is worse than one that
    // never helps, because you cannot tell whether your drag took.
    assert.match(src, /phaseLayoutIsAdvisory = false;/);
    assert.match(src, /if \(!phaseLayoutIsAdvisory \|\| phaseKey === lastLaidOutPhase\) return;/);
  });

  test("test_layout_onlyMovesOnAPhaseChange", () => {
    // The tick runs four times a second. Re-applying a layout on each one would
    // fight every drag and make the splitters feel broken.
    assert.match(src, /lastLaidOutPhase = phaseKey;/);
  });

  test("test_layout_opensTheBoardForPlanningAndNeverClosesIt", () => {
    // "Plan" with the board hidden is the phase without its instrument. But
    // shutting a panel someone is looking at is help nobody asks for twice.
    assert.match(src, /if \(phaseKey === "plan" && !session\.whiteboardShown\) setBoard\(true\)/);
    assert.doesNotMatch(src, /setBoard\(false\)\s*;?\s*\/\/ *phase|phaseKey.*setBoard\(false\)/);
  });

  test("test_layout_doesNotApplyToAMock", () => {
    // A mock has its own five phases on a different clock, and moving the panes
    // under someone being watched is not a kindness.
    assert.match(src, /if \(!session\.isMock\) layoutForPhase\(phase\.key\)/);
  });
});
