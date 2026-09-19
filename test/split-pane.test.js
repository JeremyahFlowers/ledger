// Tests for the workspace pane arithmetic in js/split-pane.js.
//
// These matter because the workspace cannot re-render to recover: CodeMirror
// and the whiteboard are mounted live, so a bad size is written straight onto
// the DOM and stays there. A pane that collapses to zero during a drag takes
// the user's code off screen mid-session with no way back short of losing it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resizePanes, redistribute, gridTemplate, MIN_PANE } from "../js/split-pane.js";

const sum = (a) => a.reduce((s, v) => s + v, 0);

describe("resizePanes", () => {
  test("test_resizePanes_dragRight_growsLeftPaneAndShrinksRight", () => {
    const next = resizePanes([0.5, 0.5], 0, 0.1);
    assert.ok(Math.abs(next[0] - 0.6) < 1e-9);
    assert.ok(Math.abs(next[1] - 0.4) < 1e-9);
  });

  test("test_resizePanes_dragLeft_shrinksLeftPaneAndGrowsRight", () => {
    const next = resizePanes([0.5, 0.5], 0, -0.2);
    assert.ok(Math.abs(next[0] - 0.3) < 1e-9);
    assert.ok(Math.abs(next[1] - 0.7) < 1e-9);
  });

  test("test_resizePanes_totalWidthIsConserved", () => {
    // The row is always exactly full; any drift here shows as a gap or an
    // overflowing pane.
    for (const delta of [-0.9, -0.3, 0, 0.25, 0.8]) {
      assert.ok(Math.abs(sum(resizePanes([0.3, 0.4, 0.3], 1, delta)) - 1) < 1e-9,
        `sizes must still sum to 1 after a drag of ${delta}`);
    }
  });

  test("test_resizePanes_hugeDrag_clampsAtMinimumRatherThanCollapsing", () => {
    const next = resizePanes([0.5, 0.5], 0, 5);
    assert.ok(Math.abs(next[1] - MIN_PANE) < 1e-9, "the shrinking pane stops at the minimum");
    assert.ok(next[0] < 1, "and never takes the whole row");
  });

  test("test_resizePanes_hugeNegativeDrag_clampsTheOtherWay", () => {
    const next = resizePanes([0.5, 0.5], 0, -5);
    assert.ok(Math.abs(next[0] - MIN_PANE) < 1e-9);
  });

  test("test_resizePanes_onlyTouchesThePaneEitherSideOfTheSplitter", () => {
    // A drag has to feel local — panes further along must not shuffle.
    const next = resizePanes([0.2, 0.4, 0.4], 1, 0.1);
    assert.equal(next[0], 0.2);
  });

  test("test_resizePanes_pairTooNarrowToSplit_returnsSizesUnchanged", () => {
    const sizes = [0.05, 0.05, 0.9];
    assert.deepEqual(resizePanes(sizes, 0, 0.01), sizes);
  });

  test("test_resizePanes_lastSplitterIndex_isIgnoredRatherThanReadingPastTheEnd", () => {
    const sizes = [0.5, 0.5];
    assert.deepEqual(resizePanes(sizes, 1, 0.1), sizes);
  });

  test("test_resizePanes_doesNotMutateItsInput", () => {
    const sizes = [0.5, 0.5];
    resizePanes(sizes, 0, 0.2);
    assert.deepEqual(sizes, [0.5, 0.5]);
  });
});

describe("redistribute", () => {
  const FALLBACK = [0.3, 0.45, 0.25];

  test("test_redistribute_hidingAPane_sharesItsSpaceAmongTheRest", () => {
    const next = redistribute([0.3, 0.45, 0.25], [true, true, false], FALLBACK);
    assert.ok(Math.abs(sum(next) - 1) < 1e-9);
    assert.equal(next[2], 0);
  });

  test("test_redistribute_keepsTheRelativeProportionsOfWhatStays", () => {
    // Toggling the whiteboard off and back on should return roughly to the
    // arrangement the user set, not reset to even columns.
    const next = redistribute([0.2, 0.6, 0.2], [true, true, false], FALLBACK);
    assert.ok(Math.abs(next[1] / next[0] - 3) < 1e-9, "the 1:3 ratio survives the hide");
  });

  test("test_redistribute_showingAPaneBack_usesItsFallbackShare", () => {
    const next = redistribute([0.25, 0.75, 0], [true, true, true], FALLBACK);
    assert.ok(next[2] > 0, "a pane coming back must get real width");
    assert.ok(Math.abs(sum(next) - 1) < 1e-9);
  });

  test("test_redistribute_nothingCarriedOver_fallsBackInsteadOfDividingByZero", () => {
    const next = redistribute([0, 0, 0], [true, false, true], FALLBACK);
    assert.ok(Math.abs(sum(next) - 1) < 1e-9);
    assert.ok(Number.isFinite(next[0]) && next[0] > 0);
  });

  test("test_redistribute_everythingHidden_doesNotProduceNaN", () => {
    for (const v of redistribute([0.5, 0.5, 0], [false, false, false], FALLBACK)) {
      assert.ok(Number.isFinite(v), "a hidden row must not yield NaN track sizes");
    }
  });
});

describe("gridTemplate", () => {
  test("test_gridTemplate_putsASplitterBetweenEachVisiblePair", () => {
    const template = gridTemplate([0.5, 0.5], [true, true], 8);
    assert.equal(template.match(/8px/g).length, 1);
  });

  test("test_gridTemplate_hiddenPane_contributesNoTrackAndNoSplitter", () => {
    // A zero-width column still paints its border and its splitter, which
    // reads as a stray line down the edge of the workspace.
    const template = gridTemplate([0.4, 0.6, 0], [true, true, false], 8);
    assert.equal(template.match(/8px/g).length, 1);
    assert.equal(template.match(/%/g).length, 2, "only the two visible panes get a track");
  });

  test("test_gridTemplate_singleVisiblePane_hasNoSplitterAtAll", () => {
    assert.ok(!gridTemplate([1, 0, 0], [true, false, false], 8).includes("px"));
  });

  test("test_gridTemplate_emitsPercentagesThatSumToTheFullRow", () => {
    const template = gridTemplate([0.25, 0.5, 0.25], [true, true, true], 8);
    const total = [...template.matchAll(/([\d.]+)%/g)].reduce((s, m) => s + Number(m[1]), 0);
    assert.ok(Math.abs(total - 100) < 0.01);
  });
});
