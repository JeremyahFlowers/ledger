// The board, driven by events rather than read as source (js/whiteboard.js).
//
// It was rebuilt after "it really doesn't feel useable", and most of what was
// added is interaction: a shape that can be picked up again, an eraser that
// takes several marks as one act, text edited in place, a tool that hands
// itself back after placing one thing. None of that can be pinned by matching
// the source, and all of it can be pinned by dispatching a pointer at it.
//
// The stub below is deliberately small and lives here rather than being shared
// with scripts/check-views.mjs: what it implements *is* the list of DOM the
// board depends on, and that list is worth being able to read in one place.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { createWhiteboard } from "../js/whiteboard.js";
import { DEFAULT_FONT_SIZE, BOARD_WIDTH } from "../js/board.js";

const WIDTH = 1000;   // a 1000px pane, so one board unit is one pixel
const HEIGHT = 600;

/** Every canvas call the board makes, accepted and ignored. */
function fakeContext() {
  const noop = () => {};
  return {
    canvas: null,
    setTransform: noop, save: noop, restore: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    quadraticCurveTo: noop, arc: noop, ellipse: noop, rect: noop, roundRect: noop,
    stroke: noop, fill: noop, fillRect: noop, strokeRect: noop,
    fillText: noop, setLineDash: noop,
    // Monospace-ish, which is what the real font is, so wrapping in a test
    // behaves the way it does on screen.
    measureText: (s) => ({ width: String(s).length * 6 }),
    globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1,
    lineCap: "", lineJoin: "", font: "", textAlign: "", textBaseline: "",
  };
}

function makeElement(tag = "div") {
  const listeners = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    children: [], dataset: {}, style: {}, value: "", textContent: "", innerHTML: "",
    hidden: false, className: "", disabled: false,
    listeners,
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      const all = listeners.get(type) || [];
      const i = all.indexOf(fn);
      if (i >= 0) all.splice(i, 1);
    },
    dispatch(type, event = {}) {
      for (const fn of [...(listeners.get(type) || [])]) {
        fn({ preventDefault: () => {}, stopPropagation: () => {}, ...event });
      }
    },
    setAttribute: () => {}, removeAttribute: () => {}, getAttribute: () => null,
    toggleAttribute: () => {}, hasAttribute: () => false,
    focus: () => {}, blur: () => {}, click: () => {},
    setPointerCapture: () => {}, releasePointerCapture: () => {},
    setSelectionRange: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT }),
    getContext: () => el._ctx,
    toDataURL: () => "data:image/png;base64,stub",
    querySelector: () => null, querySelectorAll: () => [],
  };
  el._ctx = fakeContext();
  return el;
}

/** A root whose querySelector answers by selector string, because nothing here
 *  parses the HTML the board writes into it. */
function makeRoot() {
  const made = new Map();
  const get = (sel) => {
    if (!made.has(sel)) made.set(sel, makeElement(sel === "#wb-editor" ? "textarea" : "div"));
    return made.get(sel);
  };
  return {
    _nodes: made,
    set innerHTML(_) {},
    get innerHTML() { return ""; },
    querySelector: (sel) => (sel === "#wb-canvas" || sel === ".wb-stage" || sel === "#wb-editor"
      || sel.startsWith("#wb-") || sel.startsWith("[data-prop") ? get(sel) : null),
    querySelectorAll: () => [],
  };
}

let root;
let saved;

beforeEach(() => {
  saved = {
    getComputedStyle: globalThis.getComputedStyle,
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    devicePixelRatio: globalThis.devicePixelRatio,
    window: globalThis.window,
    document: globalThis.document,
  };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
  globalThis.devicePixelRatio = 1;
  const windowListeners = new Map();
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener: (type, fn) => {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    removeEventListener: () => {},
  };
  globalThis.__windowListeners = windowListeners;
  globalThis.document = { activeElement: null };
  root = makeRoot();
});

afterEach(() => { Object.assign(globalThis, saved); });

/** Deliver the window-level release the board listens for as a backstop. */
const windowEnd = (event) => {
  for (const fn of globalThis.__windowListeners.get("pointerup") || []) {
    fn({ preventDefault: () => {}, stopPropagation: () => {}, ...event });
  }
};

const canvasOf = () => root.querySelector("#wb-canvas");
const editorOf = () => root.querySelector("#wb-editor");

/** A board plus a record of everything it reported back. */
function makeSubject(hooks = {}) {
  const events = { added: [], updated: [], removed: [], cleared: 0 };
  const board = createWhiteboard(root, {
    onAdd: (el) => events.added.push(el),
    onUpdate: (el) => events.updated.push(el),
    onRemove: (id) => events.removed.push(id),
    onClear: () => { events.cleared += 1; },
    ...hooks,
  });
  return { board, events, canvas: canvasOf(), editor: editorOf() };
}

/** A press, a drag and a release, in pane pixels. */
function drag(canvas, from, to, over = {}) {
  const common = { pointerId: 1, pointerType: "mouse", button: 0, ...over };
  canvas.dispatch("pointerdown", { clientX: from.x, clientY: from.y, ...common });
  canvas.dispatch("pointermove", { clientX: to.x, clientY: to.y, ...common });
  canvas.dispatch("pointerup", { clientX: to.x, clientY: to.y, ...common });
}

const setTool = (canvas, key) =>
  canvas.dispatch("keydown", { key, metaKey: false, ctrlKey: false, shiftKey: false });

describe("placing something", () => {
  test("test_whiteboard_aDraggedBox_isAdded", () => {
    const s = makeSubject();
    setTool(s.canvas, "r");
    drag(s.canvas, { x: 100, y: 100 }, { x: 300, y: 250 });
    assert.equal(s.board.toJSON().length, 1);
    assert.equal(s.board.toJSON()[0].kind, "rect");
  });

  test("test_whiteboard_aDraggedBox_isReportedOnce", () => {
    const s = makeSubject();
    setTool(s.canvas, "r");
    drag(s.canvas, { x: 100, y: 100 }, { x: 300, y: 250 });
    assert.equal(s.events.added.length, 1, "a drag reported more than one element");
  });

  test("test_whiteboard_aTapWithNoDrag_isNotAShape", () => {
    // Otherwise every click on the board leaves an invisible zero-size element
    // behind, and they pile up where they cannot be seen or selected.
    const s = makeSubject();
    setTool(s.canvas, "r");
    drag(s.canvas, { x: 100, y: 100 }, { x: 101, y: 100 });
    assert.equal(s.board.toJSON().length, 0);
  });

  test("test_whiteboard_aPenDot_isKept", () => {
    // A dot is a legitimate mark, which is why the rule above is not universal.
    const s = makeSubject();
    setTool(s.canvas, "p");
    drag(s.canvas, { x: 100, y: 100 }, { x: 100, y: 100 });
    assert.equal(s.board.toJSON().length, 1);
  });

  test("test_whiteboard_placingAShape_handsBackTheSelectTool", () => {
    // The usual next thing is to move, size or label what was just drawn, and
    // that should not be a trip back to the toolbar. Drawing again immediately
    // would therefore drag the shape rather than make a second one.
    const s = makeSubject();
    setTool(s.canvas, "r");
    drag(s.canvas, { x: 100, y: 100 }, { x: 300, y: 250 });
    drag(s.canvas, { x: 150, y: 150 }, { x: 160, y: 160 });
    assert.equal(s.board.toJSON().length, 1, "the second drag drew instead of moving");
  });

  test("test_whiteboard_thePenStaysThePen", () => {
    // Strokes come in runs; being thrown out of the pen after each one would
    // make freehand unusable.
    const s = makeSubject();
    setTool(s.canvas, "p");
    drag(s.canvas, { x: 10, y: 10 }, { x: 60, y: 60 });
    drag(s.canvas, { x: 80, y: 80 }, { x: 120, y: 120 });
    assert.equal(s.board.toJSON().length, 2);
  });
});

describe("picking it up again", () => {
  /** A board with one box from (100,100) to (300,250), select tool in hand. */
  function withBox() {
    const s = makeSubject();
    setTool(s.canvas, "r");
    drag(s.canvas, { x: 100, y: 100 }, { x: 300, y: 250 });
    return s;
  }

  test("test_whiteboard_aPlacedShape_canBeMoved", () => {
    const s = withBox();
    // Its top edge, away from the midpoint — that is where the north grip is,
    // and a press there is a resize rather than a move.
    drag(s.canvas, { x: 150, y: 100 }, { x: 200, y: 140 });
    const b = s.board.toJSON()[0];
    assert.equal(b.points[0].x, 150, "it did not move with the pointer");
    assert.equal(b.points[0].y, 140);
    assert.equal(b.points[1].x, 350, "it resized instead of moving");
  });

  test("test_whiteboard_aMove_isReportedOnceAtTheEnd", () => {
    // Not once per pixel: the caller puts every one of these on the wire.
    const s = withBox();
    s.canvas.dispatch("pointerdown", { clientX: 200, clientY: 100, pointerId: 1, button: 0 });
    for (let x = 200; x <= 260; x += 10) {
      s.canvas.dispatch("pointermove", { clientX: x, clientY: 100, pointerId: 1, button: 0 });
    }
    s.canvas.dispatch("pointerup", { clientX: 260, clientY: 100, pointerId: 1, button: 0 });
    assert.equal(s.events.updated.length, 1, `reported ${s.events.updated.length} times`);
  });

  test("test_whiteboard_aPlacedShape_canBeResizedFromAGrip", () => {
    const s = withBox();
    drag(s.canvas, { x: 300, y: 250 }, { x: 500, y: 400 });   // the se grip
    const b = s.board.toJSON()[0];
    assert.equal(b.points[1].x, 500);
    assert.equal(b.points[1].y, 400);
  });

  test("test_whiteboard_aTapOnEmptySpace_dropsTheSelection", () => {
    const s = withBox();
    drag(s.canvas, { x: 900, y: 550 }, { x: 900, y: 550 });
    // With nothing selected the grips are gone, so a press on the corner they
    // were at grabs the shape itself: the whole box travels rather than one
    // corner of it.
    drag(s.canvas, { x: 300, y: 250 }, { x: 400, y: 300 });
    const b = s.board.toJSON()[0];
    assert.deepEqual(b.points[0], { x: 200, y: 150 }, "the far corner stayed put, so it resized");
    assert.deepEqual(b.points[1], { x: 400, y: 300 });
  });

  test("test_whiteboard_selectionIsDeletedByTheDeleteKey", () => {
    const s = withBox();
    s.canvas.dispatch("keydown", { key: "Backspace" });
    assert.equal(s.board.toJSON().length, 0);
    assert.equal(s.events.removed.length, 1);
  });

  test("test_whiteboard_arrowKeysNudgeTheSelection", () => {
    const s = withBox();
    s.canvas.dispatch("keydown", { key: "ArrowRight", shiftKey: false });
    assert.equal(s.board.toJSON()[0].points[0].x, 101);
  });

  test("test_whiteboard_shiftArrowNudgesFurther", () => {
    const s = withBox();
    s.canvas.dispatch("keydown", { key: "ArrowRight", shiftKey: true });
    assert.equal(s.board.toJSON()[0].points[0].x, 110);
  });

  test("test_whiteboard_duplicateLeavesTheOriginalWhereItWas", () => {
    const s = withBox();
    s.canvas.dispatch("keydown", { key: "d", metaKey: true });
    const all = s.board.toJSON();
    assert.equal(all.length, 2);
    assert.deepEqual(all[0].points[0], { x: 100, y: 100 });
    assert.notDeepEqual(all[1].points[0], all[0].points[0], "the copy landed exactly on top");
  });
});

describe("the eraser", () => {
  function withThreeStrokes() {
    const s = makeSubject();
    setTool(s.canvas, "p");
    drag(s.canvas, { x: 100, y: 100 }, { x: 150, y: 100 });
    drag(s.canvas, { x: 100, y: 200 }, { x: 150, y: 200 });
    drag(s.canvas, { x: 100, y: 300 }, { x: 150, y: 300 });
    return s;
  }

  test("test_whiteboard_theEraserRemovesWhatItPassesOver", () => {
    const s = withThreeStrokes();
    setTool(s.canvas, "e");
    drag(s.canvas, { x: 120, y: 100 }, { x: 120, y: 100 });
    assert.equal(s.board.toJSON().length, 2);
  });

  test("test_whiteboard_theEraserLeavesWhatItMissed", () => {
    const s = withThreeStrokes();
    setTool(s.canvas, "e");
    drag(s.canvas, { x: 600, y: 500 }, { x: 650, y: 520 });
    assert.equal(s.board.toJSON().length, 3);
  });

  test("test_whiteboard_aSweepAcrossSeveralIsOneUndo", () => {
    // It is one thing the hand did, so it is one thing Undo puts back.
    const s = withThreeStrokes();
    setTool(s.canvas, "e");
    drag(s.canvas, { x: 120, y: 90 }, { x: 120, y: 310 });
    assert.equal(s.board.toJSON().length, 0, "the sweep missed some of them");
    s.canvas.dispatch("keydown", { key: "z", metaKey: true });
    assert.equal(s.board.toJSON().length, 3, "one undo did not put the whole sweep back");
  });

  test("test_whiteboard_erasingBetweenSamples_stillErases", () => {
    // A fast swipe reports a handful of points far apart, and erasing only
    // where they landed leaves gaps the hand never saw.
    const s = withThreeStrokes();
    setTool(s.canvas, "e");
    s.canvas.dispatch("pointerdown", { clientX: 120, clientY: 90, pointerId: 1, button: 0 });
    s.canvas.dispatch("pointermove", { clientX: 120, clientY: 310, pointerId: 1, button: 0 });
    s.canvas.dispatch("pointerup", { clientX: 120, clientY: 310, pointerId: 1, button: 0 });
    assert.equal(s.board.toJSON().length, 0);
  });
});

describe("text, typed where it sits", () => {
  test("test_whiteboard_theTextTool_opensAnEditorRatherThanADialog", () => {
    // It used to be window.prompt(): one line, no size, no way back in to fix
    // a typo, and a modal dialog standing between you and the board.
    const s = makeSubject();
    setTool(s.canvas, "t");
    s.canvas.dispatch("pointerdown", { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    assert.equal(s.editor.hidden, false);
  });

  test("test_whiteboard_typingAndCommitting_keepsTheWords", () => {
    const s = makeSubject();
    setTool(s.canvas, "t");
    s.canvas.dispatch("pointerdown", { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    s.editor.value = "two pointers";
    s.editor.dispatch("input", {});
    s.editor.dispatch("keydown", { key: "Escape" });
    const all = s.board.toJSON();
    assert.equal(all.length, 1);
    assert.equal(all[0].text, "two pointers");
  });

  test("test_whiteboard_returnMakesANewLineRatherThanCommitting", () => {
    // The whole point of a text area over a prompt: a label can be more than
    // one line, and multi-line is what a whiteboard note usually is.
    const s = makeSubject();
    setTool(s.canvas, "t");
    s.canvas.dispatch("pointerdown", { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    s.editor.value = "left\nright";
    s.editor.dispatch("input", {});
    s.editor.dispatch("keydown", { key: "Enter", metaKey: false });
    assert.equal(s.editor.hidden, false, "Return closed the editor");
    s.editor.dispatch("keydown", { key: "Escape" });
    assert.equal(s.board.toJSON()[0].text, "left\nright");
  });

  test("test_whiteboard_anEmptyLabel_leavesNothingBehind", () => {
    // An empty box is invisible and unclickable, so it could be neither
    // removed nor re-entered.
    const s = makeSubject();
    setTool(s.canvas, "t");
    s.canvas.dispatch("pointerdown", { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    s.editor.value = "   ";
    s.editor.dispatch("keydown", { key: "Escape" });
    assert.equal(s.board.toJSON().length, 0);
    assert.equal(s.events.added.length, 0, "an empty label was put on the wire");
  });

  test("test_whiteboard_aLabel_canBeOpenedAgainToFixIt", () => {
    const s = makeSubject();
    setTool(s.canvas, "t");
    s.canvas.dispatch("pointerdown", { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    s.editor.value = "teo";
    s.editor.dispatch("input", {});
    s.editor.dispatch("keydown", { key: "Escape" });

    s.canvas.dispatch("dblclick", { clientX: 210, clientY: 205, pointerId: 1 });
    assert.equal(s.editor.hidden, false, "double-clicking a label did not reopen it");
    s.editor.value = "two";
    s.editor.dispatch("input", {});
    s.editor.dispatch("keydown", { key: "Escape" });
    assert.equal(s.board.toJSON()[0].text, "two");
    assert.equal(s.board.toJSON().length, 1, "editing it made a second copy");
  });

  test("test_whiteboard_aNewLabelHasASizeOfItsOwn", () => {
    // It used to take its size from the stroke-width slider, which is why it
    // could not be changed without changing the pen.
    const s = makeSubject();
    setTool(s.canvas, "t");
    s.canvas.dispatch("pointerdown", { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    s.editor.value = "x";
    s.editor.dispatch("input", {});
    s.editor.dispatch("keydown", { key: "Escape" });
    assert.equal(s.board.toJSON()[0].fontSize, DEFAULT_FONT_SIZE);
  });

  test("test_whiteboard_theEditorKeepsItsOwnKeystrokes", () => {
    // A "t" typed into a label must not switch tools, and Cmd-Z in the field
    // must undo the typing rather than the drawing.
    const s = makeSubject();
    setTool(s.canvas, "t");
    s.canvas.dispatch("pointerdown", { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    let stopped = false;
    s.editor.dispatch("keydown", { key: "t", stopPropagation: () => { stopped = true; } });
    assert.ok(stopped, "a keystroke in the editor was left to reach the board");
  });
});

describe("a release the canvas never hears", () => {
  test("test_whiteboard_aDroppedPointerUp_doesNotJamTheBoard", () => {
    // Two live pointers mean a pinch, so a pointer left in the map for ever
    // makes the *next* touch a second finger and the board quietly stops
    // drawing. A release over browser chrome, a refused capture or a system
    // dialog can all lose one. It looks exactly like the board being broken,
    // and it is what one dropped event did during testing.
    const s = makeSubject();
    setTool(s.canvas, "p");
    s.canvas.dispatch("pointerdown", { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    globalThis.window.dispatch?.("pointerup", { pointerId: 1 });
    windowEnd({ pointerId: 1, clientX: 100, clientY: 100 });

    drag(s.canvas, { x: 200, y: 200 }, { x: 300, y: 300 });
    assert.equal(s.board.toJSON().length, 2, "the board stopped drawing after a lost release");
  });
});

describe("two fingers", () => {
  test("test_whiteboard_aPinchWhileTypingDoesNotLeaveTheEditorOpen", () => {
    // The first finger opens a text box the instant it lands while the text
    // tool is in hand. Left open behind the gesture it draws its own outline
    // across the board, and a board being typed into reports itself busy — so
    // the session would stop syncing until something else closed it.
    const s = makeSubject();
    setTool(s.canvas, "t");
    s.canvas.dispatch("pointerdown", { clientX: 200, clientY: 200, pointerId: 1, pointerType: "touch" });
    assert.equal(s.editor.hidden, false);
    s.canvas.dispatch("pointerdown", { clientX: 500, clientY: 400, pointerId: 2, pointerType: "touch" });
    assert.equal(s.editor.hidden, true, "the editor stayed open behind the pinch");
    assert.equal(s.board.isDrawing(), true, "a pinch is still an interaction in progress");
    s.canvas.dispatch("pointerup", { clientX: 500, clientY: 400, pointerId: 2, pointerType: "touch" });
    s.canvas.dispatch("pointerup", { clientX: 200, clientY: 200, pointerId: 1, pointerType: "touch" });
    assert.equal(s.board.isDrawing(), false, "the board stayed busy after the fingers lifted");
    assert.equal(s.board.toJSON().length, 0, "the abandoned empty box was left on the board");
  });

  test("test_whiteboard_aSecondFinger_isAGestureNotASecondStroke", () => {
    // On a tablet this is most of what made the board feel broken: a pinch was
    // read as a second pen stroke and left a line across the drawing.
    const s = makeSubject();
    setTool(s.canvas, "p");
    s.canvas.dispatch("pointerdown", { clientX: 100, clientY: 100, pointerId: 1, pointerType: "touch" });
    s.canvas.dispatch("pointermove", { clientX: 150, clientY: 150, pointerId: 1, pointerType: "touch" });
    s.canvas.dispatch("pointerdown", { clientX: 400, clientY: 400, pointerId: 2, pointerType: "touch" });
    s.canvas.dispatch("pointermove", { clientX: 500, clientY: 500, pointerId: 2, pointerType: "touch" });
    s.canvas.dispatch("pointerup", { clientX: 500, clientY: 500, pointerId: 2, pointerType: "touch" });
    s.canvas.dispatch("pointerup", { clientX: 150, clientY: 150, pointerId: 1, pointerType: "touch" });
    assert.equal(s.board.toJSON().length, 0, "the pinch left a stroke on the board");
  });
});

describe("what the watcher's board does", () => {
  test("test_whiteboard_readOnly_bindsNoInputAtAll", () => {
    const s = makeSubject({ readOnly: true });
    for (const type of ["pointerdown", "pointermove", "pointerup", "keydown", "wheel", "dblclick"]) {
      assert.equal((s.canvas.listeners.get(type) || []).length, 0,
        `a read-only board listens for ${type}`);
    }
  });

  test("test_whiteboard_readOnly_stillDrawsWhatArrives", () => {
    const s = makeSubject({ readOnly: true });
    s.board.applyRemote({ id: "x", kind: "pen", color: "#fff", width: 3, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
    assert.equal(s.board.toJSON().length, 1);
  });
});

describe("boards that arrive from elsewhere", () => {
  test("test_whiteboard_restore_convertsTextFromOlderVersions", () => {
    // Those boards are in people's repos and in their session logs.
    const s = makeSubject();
    s.board.restore([{ id: "t", kind: "text", color: "#fff", width: 4, text: "hi", points: [{ x: 10, y: 20 }] }]);
    const [el] = s.board.toJSON();
    assert.equal(el.points.length, 2);
    assert.ok(el.fontSize > 0);
  });

  test("test_whiteboard_restore_reportsNothingBack", () => {
    // It is how a drawing arrives *from* the log; echoing it would loop.
    const s = makeSubject();
    s.board.restore([{ id: "p", kind: "pen", color: "#fff", width: 3, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }]);
    assert.equal(s.events.added.length, 0);
  });

  test("test_whiteboard_restore_ignoresJunk", () => {
    const s = makeSubject();
    s.board.restore([null, "nope", { kind: "pen" }]);
    assert.equal(s.board.toJSON().length, 0);
  });

  test("test_whiteboard_isDrawing_isTrueWhileTheHandIsDown", () => {
    // A caller replacing the board with a remote version has to wait.
    const s = makeSubject();
    setTool(s.canvas, "p");
    assert.equal(s.board.isDrawing(), false);
    s.canvas.dispatch("pointerdown", { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    assert.equal(s.board.isDrawing(), true);
    s.canvas.dispatch("pointerup", { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    assert.equal(s.board.isDrawing(), false);
  });

  test("test_whiteboard_isDrawing_isTrueWhileTypingToo", () => {
    const s = makeSubject();
    setTool(s.canvas, "t");
    s.canvas.dispatch("pointerdown", { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    assert.equal(s.board.isDrawing(), true, "a board replaced mid-sentence loses the sentence");
  });
});

describe("clearing", () => {
  test("test_whiteboard_clear_isOneUndoStep", () => {
    const s = makeSubject();
    setTool(s.canvas, "p");
    drag(s.canvas, { x: 10, y: 10 }, { x: 60, y: 60 });
    drag(s.canvas, { x: 80, y: 80 }, { x: 120, y: 120 });
    root.querySelector("#wb-clear").dispatch("click", {});
    assert.equal(s.board.isEmpty(), true);
    s.canvas.dispatch("keydown", { key: "z", metaKey: true });
    assert.equal(s.board.toJSON().length, 2);
  });

  test("test_whiteboard_clear_tellsTheOtherDevice", () => {
    // A clear that could not be undone on the other screen would leave the two
    // permanently different.
    const s = makeSubject();
    setTool(s.canvas, "p");
    drag(s.canvas, { x: 10, y: 10 }, { x: 60, y: 60 });
    root.querySelector("#wb-clear").dispatch("click", {});
    assert.equal(s.events.cleared, 1);
  });

  test("test_whiteboard_clear_onAnEmptyBoardRecordsNothing", () => {
    const s = makeSubject();
    root.querySelector("#wb-clear").dispatch("click", {});
    assert.equal(s.events.cleared, 0);
  });
});

describe("the coordinate space it stores in", () => {
  test("test_whiteboard_storesBoardUnitsNotPixels", () => {
    // Nothing stored may know how big this screen was, or the same drawing
    // opens at half scale on the other device.
    const s = makeSubject();
    setTool(s.canvas, "r");
    drag(s.canvas, { x: 0, y: 0 }, { x: WIDTH, y: 100 });
    assert.equal(s.board.toJSON()[0].points[1].x, BOARD_WIDTH);
  });
});
