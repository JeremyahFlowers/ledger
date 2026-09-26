// Resizing, zooming and wrapping — the maths behind a usable board (js/board.js).
//
// Split from board.test.js, which pins what an element *is*; this pins what can
// be done to one. It exists because the whiteboard was rebuilt after "it really
// doesn't feel useable": you could place a shape and never resize it, text was
// a browser prompt() with no size of its own, and there was no zoom, so detail
// on a tablet was whatever your finger could manage at one fixed scale.
//
// All of it is arithmetic, and all of the ways it goes wrong — a division by
// zero on a flat line, a box that inverts when you drag a grip through the far
// edge, a zoom that walks the drawing off screen — are invisible through a
// canvas and obvious here.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_WIDTH, MIN_SIZE, MIN_ZOOM, MAX_ZOOM, DEFAULT_FONT_SIZE, LINE_HEIGHT,
  makeElement, elementBounds, boundsOf, normalizeBounds,
  HANDLES, handlesFor, handlePositions, handleAt, resizeBounds, scaleElement,
  wrapText, textHeight, fitTextBox, migrateElement, migrateBoard,
  toBoard, toScreen, zoomAt, panBy,
} from "../js/board.js";

const el = (kind, points, over = {}) =>
  makeElement(kind, { id: kind, color: "#fff", width: 3, points, ...over });

const box = (x, y, w, h) => ({ x, y, w, h });

/** A monospace stub: exact, so these pin the wrapping and not a font. */
const mono = (charWidth = 10) => (s) => s.length * charWidth;

describe("a box, whichever way it was dragged", () => {
  test("test_board_normalizeBounds_negativeExtent_becomesPositive", () => {
    assert.deepEqual(normalizeBounds(box(100, 100, -40, -20)), box(60, 80, 40, 20));
  });

  test("test_board_normalizeBounds_alreadyPositive_isUnchanged", () => {
    assert.deepEqual(normalizeBounds(box(10, 20, 30, 40)), box(10, 20, 30, 40));
  });

  test("test_board_boundsOf_severalElements_isTheUnion", () => {
    const b = boundsOf([
      el("rect", [{ x: 0, y: 0 }, { x: 10, y: 10 }]),
      el("rect", [{ x: 50, y: 20 }, { x: 60, y: 90 }]),
    ]);
    assert.deepEqual(b, box(0, 0, 60, 90));
  });

  test("test_board_boundsOf_nothing_isNull", () => {
    assert.equal(boundsOf([]), null);
  });
});

describe("the grips", () => {
  test("test_board_handlePositions_aShape_offersEightGrips", () => {
    assert.equal(handlePositions(box(0, 0, 100, 50)).length, 8);
  });

  test("test_board_handlePositions_sitOnTheCornersAndEdges", () => {
    const at = Object.fromEntries(handlePositions(box(0, 0, 100, 50)).map((h) => [h.id, h]));
    assert.deepEqual({ x: at.nw.x, y: at.nw.y }, { x: 0, y: 0 });
    assert.deepEqual({ x: at.se.x, y: at.se.y }, { x: 100, y: 50 });
    assert.deepEqual({ x: at.n.x, y: at.n.y }, { x: 50, y: 0 });
    assert.deepEqual({ x: at.w.x, y: at.w.y }, { x: 0, y: 25 });
  });

  test("test_board_handlesFor_text_offersNoVerticalGrip", () => {
    // Its height is whatever its words need once wrapped, so a grip that set
    // the height would be a control whose effect is immediately overwritten.
    const grips = handlesFor(el("text", [{ x: 0, y: 0 }, { x: 10, y: 10 }]));
    assert.ok(!grips.includes("n") && !grips.includes("s"));
    assert.ok(grips.includes("e") && grips.includes("w"), "the wrap width must still be settable");
    assert.ok(grips.includes("se"), "and the corners must still scale the type");
  });

  test("test_board_handlesFor_anythingElse_offersAllEight", () => {
    assert.deepEqual(handlesFor(el("rect", [])), HANDLES);
  });

  test("test_board_handleAt_onAGrip_namesIt", () => {
    assert.equal(handleAt(box(0, 0, 100, 50), { x: 100, y: 50 }, 6), "se");
  });

  test("test_board_handleAt_inTheMiddleOfNowhere_isNull", () => {
    assert.equal(handleAt(box(0, 0, 100, 50), { x: 50, y: 25 }, 6), null);
  });

  test("test_board_handleAt_slopIsTheGrabArea", () => {
    assert.equal(handleAt(box(0, 0, 100, 50), { x: 104, y: 52 }, 6), "se");
    assert.equal(handleAt(box(0, 0, 100, 50), { x: 120, y: 52 }, 6), null);
  });
});

describe("dragging a grip", () => {
  const start = box(0, 0, 100, 50);

  test("test_board_resizeBounds_seCorner_movesThatCornerOnly", () => {
    assert.deepEqual(resizeBounds(start, "se", { x: 200, y: 120 }), box(0, 0, 200, 120));
  });

  test("test_board_resizeBounds_nwCorner_movesTheOriginAndKeepsTheFarCorner", () => {
    assert.deepEqual(resizeBounds(start, "nw", { x: -50, y: -20 }), box(-50, -20, 150, 70));
  });

  test("test_board_resizeBounds_sideGrip_leavesTheOtherAxisAlone", () => {
    const out = resizeBounds(start, "e", { x: 300, y: 999 });
    assert.equal(out.w, 300);
    assert.equal(out.h, 50, "a side grip moved the height it was not dragging");
  });

  test("test_board_resizeBounds_isComputedFromTheStartNotIncrementally", () => {
    // Every move recomputes from the box as it was when the drag began, so a
    // pointer that returns to where it started gives back the original box.
    const wandered = resizeBounds(resizeBounds(start, "se", { x: 400, y: 400 }), "se", { x: 100, y: 50 });
    assert.deepEqual(resizeBounds(start, "se", { x: 100, y: 50 }), wandered);
  });

  test("test_board_resizeBounds_draggedThroughTheFarEdge_staysGrabbable", () => {
    // Flat is unrecoverable: there would be nothing left to take hold of.
    const out = resizeBounds(start, "e", { x: -500, y: 0 });
    assert.ok(out.w >= MIN_SIZE, `collapsed to ${out.w}`);
    assert.ok(out.h >= MIN_SIZE);
  });

  test("test_board_resizeBounds_aFlatLineKeepsItsFlatAxisFlat", () => {
    // A horizontal line has no height, and forcing it to MIN_SIZE would bend it.
    const out = resizeBounds(box(0, 0, 100, 0), "e", { x: 200, y: 0 });
    assert.equal(out.h, 0);
    assert.equal(out.w, 200);
  });

  test("test_board_resizeBounds_withAspectHeld_keepsTheRatio", () => {
    const out = resizeBounds(box(0, 0, 100, 50), "se", { x: 200, y: 60 }, { keepAspect: true });
    assert.ok(Math.abs(out.w / out.h - 2) < 0.001, `ratio became ${out.w / out.h}`);
  });

  test("test_board_resizeBounds_withAspectHeld_onASideGripIsIgnored", () => {
    // One free axis, nothing to hold in ratio against.
    const out = resizeBounds(box(0, 0, 100, 50), "e", { x: 300, y: 0 }, { keepAspect: true });
    assert.equal(out.h, 50);
  });
});

describe("mapping an element into its new box", () => {
  test("test_board_scaleElement_everyPointMovesWithTheBox", () => {
    const shape = el("rect", [{ x: 0, y: 0 }, { x: 100, y: 50 }]);
    const out = scaleElement(shape, box(0, 0, 100, 50), box(0, 0, 200, 100));
    assert.deepEqual(out.points, [{ x: 0, y: 0 }, { x: 200, y: 100 }]);
  });

  test("test_board_scaleElement_aStrokeKeepsItsShape", () => {
    const pen = el("pen", [{ x: 0, y: 0 }, { x: 50, y: 25 }, { x: 100, y: 0 }]);
    const out = scaleElement(pen, box(0, 0, 100, 25), box(0, 0, 200, 50));
    assert.deepEqual(out.points, [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 0 }]);
  });

  test("test_board_scaleElement_aFlatLineDoesNotBecomeNaN", () => {
    // from.h is 0. Dividing by it is how a shape stops drawing forever.
    const line = el("line", [{ x: 0, y: 40 }, { x: 100, y: 40 }]);
    const out = scaleElement(line, box(0, 40, 100, 0), box(0, 40, 200, 0));
    for (const p of out.points) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `got ${JSON.stringify(p)}`);
    }
    assert.deepEqual(out.points, [{ x: 0, y: 40 }, { x: 200, y: 40 }]);
  });

  test("test_board_scaleElement_doesNotMutateTheOriginal", () => {
    const shape = el("rect", [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    scaleElement(shape, box(0, 0, 10, 10), box(0, 0, 99, 99));
    assert.deepEqual(shape.points, [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
  });

  test("test_board_scaleElement_textOnACorner_scalesTheType", () => {
    const t = el("text", [{ x: 0, y: 0 }, { x: 100, y: 30 }], { text: "hi", fontSize: 20 });
    const out = scaleElement(t, box(0, 0, 100, 30), box(0, 0, 200, 60));
    assert.equal(out.fontSize, 40);
  });

  test("test_board_scaleElement_textOnASideGrip_leavesTheTypeAlone", () => {
    // Only the wrap width changed, so the words rewrap at the size they were.
    const t = el("text", [{ x: 0, y: 0 }, { x: 100, y: 30 }], { text: "hi", fontSize: 20 });
    const out = scaleElement(t, box(0, 0, 100, 30), box(0, 0, 300, 30));
    assert.equal(out.fontSize, 20);
  });

  test("test_board_scaleElement_textNeverScalesToNothing", () => {
    const t = el("text", [{ x: 0, y: 0 }, { x: 100, y: 30 }], { text: "hi", fontSize: 20 });
    const out = scaleElement(t, box(0, 0, 100, 30), box(0, 0, 1, 1));
    assert.ok(out.fontSize >= 4, `shrank to ${out.fontSize}`);
  });
});

describe("wrapping words", () => {
  test("test_board_wrapText_shortEnough_isOneLine", () => {
    assert.deepEqual(wrapText("two words", 1000, mono()), ["two words"]);
  });

  test("test_board_wrapText_tooLong_breaksBetweenWords", () => {
    assert.deepEqual(wrapText("aaa bbb ccc", 70, mono()), ["aaa bbb", "ccc"]);
  });

  test("test_board_wrapText_keepsExplicitNewlines", () => {
    assert.deepEqual(wrapText("one\ntwo", 1000, mono()), ["one", "two"]);
  });

  test("test_board_wrapText_keepsBlankLines", () => {
    // Two presses of Return is a paragraph break, and losing it silently
    // rewrites what someone typed.
    assert.deepEqual(wrapText("a\n\nb", 1000, mono()), ["a", "", "b"]);
  });

  test("test_board_wrapText_aWordLongerThanTheBox_isBrokenNotOverflowed", () => {
    const lines = wrapText("abcdefghij", 30, mono());
    assert.ok(lines.length > 1, "the word ran out of the box instead of breaking");
    assert.equal(lines.join(""), "abcdefghij", "breaking it lost or duplicated characters");
  });

  test("test_board_wrapText_emptyString_isOneEmptyLine", () => {
    assert.deepEqual(wrapText("", 100, mono()), [""]);
  });

  test("test_board_wrapText_nullish_doesNotThrow", () => {
    assert.deepEqual(wrapText(null, 100, mono()), [""]);
  });

  test("test_board_textHeight_growsWithTheLineCount", () => {
    assert.equal(textHeight(3, 20), 3 * 20 * LINE_HEIGHT);
  });

  test("test_board_textHeight_noLines_stillHasOneLineOfRoom", () => {
    // An empty box you cannot see is an empty box you cannot click back into.
    assert.equal(textHeight(0, 20), 20 * LINE_HEIGHT);
  });
});

describe("fitting a text box to its words", () => {
  test("test_board_fitTextBox_heightFollowsTheWrappedLines", () => {
    const t = el("text", [{ x: 0, y: 0 }, { x: 70, y: 999 }], { text: "aaa bbb ccc", fontSize: 20 });
    const out = fitTextBox(t, mono());
    assert.equal(elementBounds(out).h, textHeight(2, 20));
  });

  test("test_board_fitTextBox_leavesTheWrapWidthAlone", () => {
    const t = el("text", [{ x: 5, y: 5 }, { x: 105, y: 40 }], { text: "hi", fontSize: 20 });
    const out = fitTextBox(t, mono());
    const b = elementBounds(out);
    assert.equal(b.x, 5);
    assert.equal(b.w, 100, "re-fitting changed the width the side grips set");
  });

  test("test_board_fitTextBox_empty_keepsABoxYouCanClick", () => {
    const t = el("text", [{ x: 0, y: 0 }, { x: 100, y: 0 }], { text: "", fontSize: 20 });
    assert.ok(elementBounds(fitTextBox(t, mono())).h > 0);
  });
});

describe("boards drawn by an older version", () => {
  test("test_board_migrateElement_oldAnchorText_becomesABox", () => {
    const old = { id: "t", kind: "text", color: "#fff", width: 4, text: "hello", points: [{ x: 100, y: 200 }] };
    const out = migrateElement(old);
    assert.equal(out.points.length, 2);
    assert.ok(out.fontSize > 0);
    assert.ok(elementBounds(out).w > 0 && elementBounds(out).h > 0);
  });

  test("test_board_migrateElement_oldText_takesItsSizeFromTheOldStrokeWidth", () => {
    // That is what drew it before, so it comes back the size it was drawn.
    const out = migrateElement({ id: "t", kind: "text", width: 4, text: "x", points: [{ x: 0, y: 0 }] });
    assert.equal(out.fontSize, 24);
  });

  test("test_board_migrateElement_oldText_sitsWhereItUsedToBeDrawn", () => {
    // The old point was a baseline, so the box has to sit above it.
    const out = migrateElement({ id: "t", kind: "text", width: 4, text: "x", points: [{ x: 0, y: 100 }] });
    assert.ok(elementBounds(out).y < 100);
  });

  test("test_board_migrateElement_currentText_isLeftAlone", () => {
    const now = el("text", [{ x: 0, y: 0 }, { x: 50, y: 20 }], { text: "x", fontSize: 18 });
    assert.deepEqual(migrateElement(now), now);
  });

  test("test_board_migrateElement_anythingNotText_isLeftAlone", () => {
    const pen = el("pen", [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    assert.deepEqual(migrateElement(pen), pen);
  });

  test("test_board_migrateElement_junk_isDropped", () => {
    assert.equal(migrateElement(null), null);
    assert.equal(migrateElement({ kind: "pen" }), null);
    assert.equal(migrateElement({ kind: "text", points: [] }), null);
  });

  test("test_board_migrateBoard_dropsWhatItCannotRead", () => {
    const out = migrateBoard([null, { kind: "pen", points: [{ x: 0, y: 0 }] }, "nonsense"]);
    assert.equal(out.length, 1);
  });

  test("test_board_migrateBoard_notAnArray_isAnEmptyBoard", () => {
    assert.deepEqual(migrateBoard(undefined), []);
  });
});

describe("panning and zooming", () => {
  const WIDTH = 500;   // a 500px pane, so one board unit is half a pixel

  test("test_board_toBoard_unzoomed_isTheOldBehaviour", () => {
    assert.deepEqual(toBoard({ x: 250, y: 250 }, WIDTH), { x: BOARD_WIDTH / 2, y: BOARD_WIDTH / 2 });
  });

  test("test_board_toBoard_andBack_areInverses", () => {
    const view = { scale: 2.5, x: 120, y: -40 };
    const screen = { x: 187, y: 96 };
    const round = toScreen(toBoard(screen, WIDTH, view), WIDTH, view);
    assert.ok(Math.abs(round.x - screen.x) < 1e-9 && Math.abs(round.y - screen.y) < 1e-9);
  });

  test("test_board_zoomAt_keepsWhatIsUnderThePointerUnderIt", () => {
    // The whole reason to zoom about the pointer: otherwise every zoom needs a
    // pan afterwards to get back to what you were looking at.
    const view = { scale: 1, x: 0, y: 0 };
    const cursor = { x: 400, y: 300 };
    const before = toBoard(cursor, WIDTH, view);
    const after = toBoard(cursor, WIDTH, zoomAt(view, cursor, 1.8, WIDTH));
    assert.ok(Math.abs(before.x - after.x) < 1e-9, `drifted ${before.x - after.x}`);
    assert.ok(Math.abs(before.y - after.y) < 1e-9);
  });

  test("test_board_zoomAt_stopsAtTheLimits", () => {
    let view = { scale: 1, x: 0, y: 0 };
    for (let i = 0; i < 50; i++) view = zoomAt(view, { x: 0, y: 0 }, 1.5, WIDTH);
    assert.equal(view.scale, MAX_ZOOM);
    for (let i = 0; i < 100; i++) view = zoomAt(view, { x: 0, y: 0 }, 0.5, WIDTH);
    assert.equal(view.scale, MIN_ZOOM);
  });

  test("test_board_zoomAt_atTheLimit_returnsTheSameViewUntouched", () => {
    const at = { scale: MAX_ZOOM, x: 10, y: 20 };
    assert.equal(zoomAt(at, { x: 0, y: 0 }, 2, WIDTH), at);
  });

  test("test_board_panBy_movesTheBoardWithTheHand", () => {
    // Drag right, and what was off to the left comes into view.
    const view = panBy({ scale: 1, x: 0, y: 0 }, 50, 0, WIDTH);
    assert.ok(view.x < 0);
  });

  test("test_board_panBy_isScaledByTheZoom", () => {
    // The same pixel drag covers less board when you are zoomed in, or the
    // drawing would tear away from the finger holding it.
    const out = panBy({ scale: 1, x: 0, y: 0 }, 50, 0, WIDTH);
    const zoomed = panBy({ scale: 2, x: 0, y: 0 }, 50, 0, WIDTH);
    assert.ok(Math.abs(zoomed.x) < Math.abs(out.x));
  });

  test("test_board_zoomLimits_areTheRightWayRound", () => {
    assert.ok(MIN_ZOOM < 1 && MAX_ZOOM > 1);
  });

  test("test_board_defaultFontSize_isReadableOnADefaultBoard", () => {
    // A board is BOARD_WIDTH units across; type has to be a sane fraction of it.
    assert.ok(DEFAULT_FONT_SIZE > BOARD_WIDTH / 100 && DEFAULT_FONT_SIZE < BOARD_WIDTH / 10);
  });
});
