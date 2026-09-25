// What is on a whiteboard, and where (js/board.js).
//
// Split out of whiteboard.js when the board grew past freehand strokes.
// Hit-testing, bounds and coordinate maths are miserable to debug through a
// canvas and trivial to test on their own, which is the whole reason this file
// has no canvas in it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_WIDTH, ELEMENT_KINDS, HIT_SLOP, makeElement, toBoard, toScreen,
  elementBounds, hitsElement, elementAt, movedBy, snapToAngle, cellLines, cellLabels,
} from "../js/board.js";

const el = (kind, points, over = {}) =>
  makeElement(kind, { id: kind, color: "#fff", width: 3, points, ...over });

describe("coordinates survive leaving the device they were drawn on", () => {
  // The bug this exists to prevent: points were stored in device pixels of
  // whatever canvas drew them, so a diagram made on a retina tablet rendered at
  // half scale on a laptop, and dragging the pane narrower squashed everything
  // in it. Cross-device sync would have made that visible on day one.

  test("test_board_aClickHalfwayAcrossAnyPaneIsHalfwayAcrossTheBoard", () => {
    for (const paneWidth of [320, 800, 1440, 2560]) {
      const p = toBoard({ x: paneWidth / 2, y: 0 }, paneWidth);
      assert.equal(Math.round(p.x), BOARD_WIDTH / 2, `${paneWidth}px pane`);
    }
  });

  test("test_board_xAndYShareAScaleSoNothingIsStretched", () => {
    // Normalising each axis to its own extent would distort every circle the
    // moment the pane is not square.
    const p = toBoard({ x: 100, y: 100 }, 800);
    assert.equal(p.x, p.y);
  });

  test("test_board_screenAndBoardAreInverses", () => {
    for (const paneWidth of [375, 900, 1600]) {
      const round = toScreen(toBoard({ x: 123, y: 456 }, paneWidth), paneWidth);
      assert.ok(Math.abs(round.x - 123) < 1e-9);
      assert.ok(Math.abs(round.y - 456) < 1e-9);
    }
  });

  test("test_board_nothingStoredKnowsHowBigAScreenIs", () => {
    const e = el("pen", [{ x: 10, y: 20 }]);
    assert.deepEqual(Object.keys(e).sort(), ["color", "id", "kind", "points", "width"]);
  });
});

describe("bounds", () => {
  test("test_board_aStrokesBoxIsItsExtent", () => {
    assert.deepEqual(elementBounds(el("pen", [{ x: 10, y: 40 }, { x: 60, y: 20 }])),
      { x: 10, y: 20, w: 50, h: 20 });
  });

  test("test_board_boundsHandleAnyCornerOrder", () => {
    // Dragging a box up and to the left is as ordinary as down and to the right.
    const a = elementBounds(el("rect", [{ x: 100, y: 100 }, { x: 0, y: 0 }]));
    const b = elementBounds(el("rect", [{ x: 0, y: 0 }, { x: 100, y: 100 }]));
    assert.deepEqual(a, b);
  });

  test("test_board_anEmptyElementHasNoBounds", () => {
    assert.equal(elementBounds(el("pen", [])), null);
  });

  test("test_board_textIsAnAnchorWithABoxAroundIt", () => {
    // It has to be clickable before it is measured, so the box is estimated
    // from the string rather than from a canvas metric.
    const b = elementBounds(el("text", [{ x: 50, y: 50 }], { text: "left" }));
    assert.ok(b.w > 0 && b.h > 0);
    assert.ok(b.y < 50, "the anchor is the baseline, so the box sits above it");
  });
});

describe("hit-testing", () => {
  test("test_board_aStrokeIsHitAlongItsLength", () => {
    const stroke = el("pen", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    assert.equal(hitsElement(stroke, { x: 50, y: 0 }), true);
    assert.equal(hitsElement(stroke, { x: 100, y: 50 }), true);
    assert.equal(hitsElement(stroke, { x: 50, y: 50 }), false, "the inside of the corner is not the stroke");
  });

  test("test_board_aStrokeIsHitWithinTheSlopNotOnlyExactly", () => {
    // Nobody clicks a one-pixel line, least of all with a finger.
    const stroke = el("pen", [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    assert.equal(hitsElement(stroke, { x: 50, y: HIT_SLOP - 1 }), true);
    assert.equal(hitsElement(stroke, { x: 50, y: HIT_SLOP * 3 }), false);
  });

  test("test_board_anOutlineIsHitOnItsEdgeNotItsFill", () => {
    // A box drawn around a diagram would otherwise swallow every click inside
    // it, and the thing you meant to grab is the thing you can see.
    const box = el("rect", [{ x: 0, y: 0 }, { x: 200, y: 200 }]);
    assert.equal(hitsElement(box, { x: 0, y: 100 }), true);
    assert.equal(hitsElement(box, { x: 100, y: 100 }), false);
  });

  test("test_board_anEllipseIsHitOnItsCurve", () => {
    const oval = el("ellipse", [{ x: 0, y: 0 }, { x: 200, y: 100 }]);
    assert.equal(hitsElement(oval, { x: 0, y: 50 }), true, "the left edge");
    assert.equal(hitsElement(oval, { x: 100, y: 50 }), false, "the middle");
    assert.equal(hitsElement(oval, { x: 0, y: 0 }), false, "the corner of its box is outside the curve");
  });

  test("test_board_aGridIsHitAnywhereInsideIt", () => {
    // Its interior lines make it all edge, and a click in a cell plainly means
    // that grid.
    const grid = el("cells", [{ x: 0, y: 0 }, { x: 400, y: 50 }], { cols: 8 });
    assert.equal(hitsElement(grid, { x: 200, y: 25 }), true);
    assert.equal(hitsElement(grid, { x: 600, y: 25 }), false);
  });

  test("test_board_nothingIsHitByAnEmptyElement", () => {
    assert.equal(hitsElement(el("pen", []), { x: 0, y: 0 }), false);
  });

  test("test_board_anUnknownKindIsNeverHit", () => {
    // Rather than throwing, because a log could contain anything.
    assert.equal(hitsElement({ kind: "nonsense", points: [{ x: 0, y: 0 }] }, { x: 0, y: 0 }), false);
  });
});

describe("picking one thing out of many", () => {
  test("test_board_theTopmostElementWins", () => {
    // Last drawn is what you see, so it is what you meant to click.
    const under = el("rect", [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    const over = { ...el("rect", [{ x: 0, y: 0 }, { x: 100, y: 100 }]), id: "over" };
    assert.equal(elementAt([under, over], { x: 0, y: 50 }).id, "over");
  });

  test("test_board_emptySpaceSelectsNothing", () => {
    assert.equal(elementAt([el("pen", [{ x: 0, y: 0 }])], { x: 900, y: 900 }), null);
  });

  test("test_board_anEmptyBoardDoesNotThrow", () => {
    assert.equal(elementAt([], { x: 0, y: 0 }), null);
  });
});

describe("moving", () => {
  test("test_board_everyPointMoves", () => {
    const m = movedBy(el("pen", [{ x: 0, y: 0 }, { x: 10, y: 10 }]), 5, -5);
    assert.deepEqual(m.points, [{ x: 5, y: -5 }, { x: 15, y: 5 }]);
  });

  test("test_board_movingDoesNotMutateTheOriginal", () => {
    // The log is append-only; the original is somebody's history.
    const original = el("pen", [{ x: 0, y: 0 }]);
    movedBy(original, 50, 50);
    assert.deepEqual(original.points, [{ x: 0, y: 0 }]);
  });

  test("test_board_movingKeepsEverythingElse", () => {
    const m = movedBy(el("text", [{ x: 0, y: 0 }], { text: "i" }), 1, 1);
    assert.equal(m.text, "i");
    assert.equal(m.kind, "text");
  });
});

describe("straightening", () => {
  test("test_board_aNearlyHorizontalLineBecomesHorizontal", () => {
    // The reason to have an arrow tool rather than freehand is that it comes
    // out straight; a wobbly one between two boxes reads as a mistake.
    const p = snapToAngle({ x: 0, y: 0 }, { x: 100, y: 7 });
    assert.ok(Math.abs(p.y) < 1e-9);
    assert.ok(Math.abs(p.x - Math.hypot(100, 7)) < 1e-9, "length is kept");
  });

  test("test_board_aNearlyDiagonalLineBecomesDiagonal", () => {
    const p = snapToAngle({ x: 0, y: 0 }, { x: 100, y: 84 });
    assert.ok(Math.abs(p.x - p.y) < 1e-9);
  });

  test("test_board_aZeroLengthDragIsLeftAlone", () => {
    assert.deepEqual(snapToAngle({ x: 5, y: 5 }, { x: 5, y: 5 }), { x: 5, y: 5 });
  });
});

describe("arrays and grids", () => {
  // The single most-drawn thing in a coding interview, and the most tedious to
  // produce freehand under time pressure.

  test("test_board_anArrayOfNCellsHasNPlusOneVerticalLines", () => {
    const grid = el("cells", [{ x: 0, y: 0 }, { x: 400, y: 50 }], { cols: 8, rows: 1 });
    const verticals = cellLines(grid).filter(([a, b]) => a.x === b.x);
    assert.equal(verticals.length, 9);
  });

  test("test_board_cellsAreEqualWidth", () => {
    // An index is not wider because its number is.
    const grid = el("cells", [{ x: 0, y: 0 }, { x: 300, y: 50 }], { cols: 3 });
    const xs = cellLines(grid).filter(([a, b]) => a.x === b.x).map(([a]) => a.x);
    assert.deepEqual(xs, [0, 100, 200, 300]);
  });

  test("test_board_aSingleRowGetsIndexLabels", () => {
    const labels = cellLabels(el("cells", [{ x: 0, y: 0 }, { x: 400, y: 50 }], { cols: 4 }));
    assert.deepEqual(labels.map((l) => l.index), [0, 1, 2, 3]);
  });

  test("test_board_labelsSitUnderTheirOwnCell", () => {
    const labels = cellLabels(el("cells", [{ x: 0, y: 0 }, { x: 400, y: 50 }], { cols: 4 }));
    assert.deepEqual(labels.map((l) => l.x), [50, 150, 250, 350]);
    assert.ok(labels.every((l) => l.y > 50), "labels belong below the row, not inside it");
  });

  test("test_board_aMultiRowGridHasNoIndexLabels", () => {
    // Indices are an array idea. A 2D grid's cells are addressed by two
    // numbers, and one row of labels under it would be misleading.
    assert.deepEqual(cellLabels(el("cells", [{ x: 0, y: 0 }, { x: 400, y: 200 }], { cols: 4, rows: 4 })), []);
  });

  test("test_board_aGridWithNoColumnsDoesNotDivideByZero", () => {
    assert.doesNotThrow(() => cellLines(el("cells", [{ x: 0, y: 0 }, { x: 10, y: 10 }], { cols: 0 })));
  });
});

describe("the kinds", () => {
  test("test_board_everyKindSaysHowManyPointsDefineIt", () => {
    for (const [kind, spec] of Object.entries(ELEMENT_KINDS)) {
      assert.ok(spec.points === "many" || spec.points >= 1, kind);
      assert.ok(spec.label, `${kind} has no label for its toolbar button`);
    }
  });

  test("test_board_theKindsCoverWhatAnInterviewNeedsDrawing", () => {
    // Arrays and pointers, trees and graphs, boxes and labels.
    for (const kind of ["pen", "line", "arrow", "rect", "ellipse", "text", "cells"]) {
      assert.ok(ELEMENT_KINDS[kind], `no ${kind} tool`);
    }
  });
});
