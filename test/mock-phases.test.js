// Tests for mock interview structure (js/logic.js).
//
// A mock used to be an ordinary session with a pill on it and five prompts in
// a box. Nothing about it felt different from practising alone, which is the
// entire point of practising one: the pressure, a clock you can't quietly
// ignore, and the habit of saying what you're doing before you do it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { mockPhase, MOCK_PHASES, MOCK_MINUTES } from "../js/logic.js";

describe("MOCK_PHASES", () => {
  test("test_phases_coverTheWholeInterview", () => {
    // A gap would leave a stretch with no prompt at all.
    assert.equal(MOCK_PHASES[MOCK_PHASES.length - 1].until, 1);
  });

  test("test_phases_areInOrder", () => {
    for (let i = 1; i < MOCK_PHASES.length; i++) {
      assert.ok(MOCK_PHASES[i].until > MOCK_PHASES[i - 1].until,
        "phases must advance, or one is unreachable");
    }
  });

  test("test_phases_eachSaysWhatToDo", () => {
    for (const p of MOCK_PHASES) {
      assert.ok(p.label && p.prompt.length > 20, `${p.label} needs a usable prompt`);
    }
  });
});

describe("mockPhase", () => {
  test("test_mockPhase_opens_byClarifying", () => {
    // Asking about constraints before writing anything is the habit most
    // worth drilling, so it is what minute zero says.
    assert.equal(mockPhase(0).label, "Clarify");
  });

  test("test_mockPhase_approachComesBeforeCoding", () => {
    const approach = mockPhase(MOCK_MINUTES * 0.18);
    assert.equal(approach.label, "Approach");
  });

  test("test_mockPhase_theMiddleIsCoding", () => {
    assert.equal(mockPhase(MOCK_MINUTES * 0.5).label, "Code");
  });

  test("test_mockPhase_endsOnComplexityThenTesting", () => {
    assert.equal(mockPhase(MOCK_MINUTES * 0.8).label, "Complexity");
    assert.equal(mockPhase(MOCK_MINUTES * 0.95).label, "Test");
  });

  test("test_mockPhase_countsDownRatherThanUp", () => {
    assert.equal(mockPhase(10).remainingMin, MOCK_MINUTES - 10);
  });

  test("test_mockPhase_runningOver_isReportedNotClamped", () => {
    // An interview that quietly stops counting teaches the opposite of the
    // lesson.
    const over = mockPhase(MOCK_MINUTES + 7);
    assert.equal(over.overrun, true);
    assert.equal(over.remainingMin, -7);
  });

  test("test_mockPhase_theLastStretchIsMarkedUrgent", () => {
    assert.equal(mockPhase(MOCK_MINUTES * 0.5).urgent, false);
    assert.equal(mockPhase(MOCK_MINUTES * 0.95).urgent, true);
  });

  test("test_mockPhase_scalesToADifferentLength", () => {
    // Proportions, not fixed minutes: "approach before coding" means early,
    // not minute five.
    assert.equal(mockPhase(30 * 0.5, 30).label, mockPhase(60 * 0.5, 60).label);
  });

  test("test_mockPhase_zeroLength_doesNotDivideByZero", () => {
    assert.doesNotThrow(() => mockPhase(5, 0));
    assert.ok(Number.isFinite(mockPhase(5, 0).remainingMin));
  });
});
