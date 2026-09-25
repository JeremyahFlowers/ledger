// What is on a whiteboard, and where — with no canvas in sight.
//
// Where this fits: pure geometry and data, below whiteboard.js, which draws it,
// and beside session-log.js, which syncs it. Split out when the board grew past
// freehand strokes: hit-testing, elementBounds and coordinate maths are exactly the
// kind of thing that is miserable to debug through a canvas and trivial to test
// on its own.
//
// Two decisions shape everything here.
//
// **Coordinates are logical, not pixels.** The original board stored points in
// device pixels of whatever canvas drew them, which is fine until the same
// drawing opens somewhere else: a diagram made on a retina tablet rendered at
// half scale on a laptop, and a pane dragged narrower squashed everything in
// it. Elements are stored in a space that is BOARD_WIDTH units across, and the
// canvas maps that to its own size on the way in and out. Nothing stored knows
// how big any screen is.
//
// **Everything is an element.** A freehand stroke, an arrow, a label and an
// array diagram are the same kind of thing with different `kind`s, so undo,
// selection, moving, deletion, serialization and sync each have one
// implementation rather than one per tool.

/** The logical width of the board. Height is whatever the pane's aspect gives,
 *  in the same units, so proportions survive a resize and a different screen. */
export const BOARD_WIDTH = 1000;

/** Elements, and how many points define each. */
export const ELEMENT_KINDS = {
  pen: { points: "many", label: "Pen" },
  line: { points: 2, label: "Line" },
  arrow: { points: 2, label: "Arrow" },
  rect: { points: 2, label: "Box" },
  ellipse: { points: 2, label: "Circle" },
  text: { points: 1, label: "Text" },
  // An array or a grid: the single most-drawn thing in a coding interview, and
  // the most tedious to produce freehand under time pressure.
  cells: { points: 2, label: "Array" },
};

/** How close a click has to be to count as hitting something, in board units. */
export const HIT_SLOP = 10;

export function makeElement(kind, { id, color, width = 3, points = [], text = "", cols = 8, rows = 1 }) {
  return { id, kind, color, width, points, ...(kind === "text" ? { text } : {}), ...(kind === "cells" ? { cols, rows } : {}) };
}

/** Screen pixels to board units. The scale comes from width alone, so x and y
 *  share it and nothing is stretched. */
export function toBoard(point, rectWidth) {
  const scale = BOARD_WIDTH / (rectWidth || 1);
  return { x: point.x * scale, y: point.y * scale };
}

export function toScreen(point, rectWidth) {
  const scale = (rectWidth || 1) / BOARD_WIDTH;
  return { x: point.x * scale, y: point.y * scale };
}

/** The box an element occupies, for hit-testing and for drawing a selection. */
export function elementBounds(el) {
  const pts = el.points || [];
  if (!pts.length) return null;
  if (el.kind === "text") {
    // A text element is one anchor point; its box is estimated from the string,
    // which is enough to click on and cheap enough to do without measuring.
    const w = Math.max(20, (el.text || "").length * el.width * 2.2);
    const h = el.width * 5;
    return { x: pts[0].x, y: pts[0].y - h * 0.8, w, h };
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const near = (a, b, slop) => Math.abs(a - b) <= slop;

/** Distance from a point to a segment — the workhorse of hit-testing a stroke. */
function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Is this point on this element?
 *
 * Outlines are hit on their edge rather than their fill, deliberately. A box
 * drawn round a diagram would otherwise swallow every click inside it, and the
 * thing you meant to grab is almost always the thing you can see.
 */
export function hitsElement(el, point, slop = HIT_SLOP) {
  const pts = el.points || [];
  if (!pts.length) return false;

  switch (el.kind) {
    case "pen":
    case "line":
    case "arrow": {
      for (let i = 1; i < pts.length; i++) {
        if (distanceToSegment(point, pts[i - 1], pts[i]) <= slop) return true;
      }
      return pts.length === 1 && Math.hypot(point.x - pts[0].x, point.y - pts[0].y) <= slop;
    }
    case "text": {
      const b = elementBounds(el);
      return point.x >= b.x - slop && point.x <= b.x + b.w + slop
        && point.y >= b.y - slop && point.y <= b.y + b.h + slop;
    }
    case "rect":
    case "cells": {
      const b = elementBounds(el);
      const insideX = point.x >= b.x - slop && point.x <= b.x + b.w + slop;
      const insideY = point.y >= b.y - slop && point.y <= b.y + b.h + slop;
      if (!insideX || !insideY) return false;
      // On the edge, not in the middle.
      return near(point.x, b.x, slop) || near(point.x, b.x + b.w, slop)
        || near(point.y, b.y, slop) || near(point.y, b.y + b.h, slop)
        || el.kind === "cells";   // a grid's interior lines make it all edge
    }
    case "ellipse": {
      const b = elementBounds(el);
      const rx = b.w / 2;
      const ry = b.h / 2;
      if (rx <= 0 || ry <= 0) return false;
      const nx = (point.x - (b.x + rx)) / rx;
      const ny = (point.y - (b.y + ry)) / ry;
      const d = Math.hypot(nx, ny);
      const edge = slop / Math.min(rx, ry);
      return Math.abs(d - 1) <= edge;
    }
    default:
      return false;
  }
}

/** The topmost element under a point — last drawn wins, which is what you see. */
export function elementAt(elements, point, slop = HIT_SLOP) {
  for (let i = elements.length - 1; i >= 0; i--) {
    if (hitsElement(elements[i], point, slop)) return elements[i];
  }
  return null;
}

export function movedBy(el, dx, dy) {
  return { ...el, points: (el.points || []).map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}

/**
 * Straighten a two-point shape to the nearest axis or diagonal.
 *
 * Held with shift, and applied to arrows by default at a tight angle. A wobbly
 * hand-drawn arrow between two boxes reads as a mistake; the whole reason to
 * have an arrow tool rather than freehand is that it comes out straight.
 */
export function snapToAngle(from, to, { angles = 8 } = {}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return to;
  const step = (Math.PI * 2) / angles;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

/**
 * The lines of an array or grid, given its two corners.
 *
 * Returned as geometry rather than drawn here, so the same definition serves
 * the canvas, a hit-test and any future export. Cells are equal width, which is
 * what an array diagram wants — an index is not wider because its number is.
 */
export function cellLines(el) {
  const b = elementBounds(el);
  const cols = Math.max(1, el.cols || 1);
  const rows = Math.max(1, el.rows || 1);
  const lines = [];
  for (let c = 0; c <= cols; c++) {
    const x = b.x + (b.w * c) / cols;
    lines.push([{ x, y: b.y }, { x, y: b.y + b.h }]);
  }
  for (let r = 0; r <= rows; r++) {
    const y = b.y + (b.h * r) / rows;
    lines.push([{ x: b.x, y }, { x: b.x + b.w, y }]);
  }
  return lines;
}

/** Where each cell's index label goes, for an array drawn as a single row. */
export function cellLabels(el) {
  const b = elementBounds(el);
  const cols = Math.max(1, el.cols || 1);
  const rows = Math.max(1, el.rows || 1);
  if (rows !== 1) return [];
  const out = [];
  for (let c = 0; c < cols; c++) {
    out.push({ index: c, x: b.x + (b.w * (c + 0.5)) / cols, y: b.y + b.h + el.width * 4 });
  }
  return out;
}

/**
 * An undo stack of reversible steps.
 *
 * Here rather than inside the canvas because the bug it had was pure logic and
 * a canvas made it invisible: undo pushed the inverse of the inverse, so redo
 * re-applied the *undo* — putting a deleted box back and then adding a second
 * copy of it. Nothing about that needed a drawing surface to go wrong, and
 * nothing about it needs one to be checked.
 *
 * `recording` is the whole mechanism. A reversal calls the same add/remove
 * functions an ordinary action does, so without suppressing it each undo would
 * record itself as a new step and the stack would never empty.
 */
export function createHistory() {
  const past = [];
  const future = [];
  let recording = true;

  const run = (fn) => {
    recording = false;
    try { fn(); } finally { recording = true; }
  };

  return {
    /** Remember a step. Ignored while undoing or redoing. */
    record(entry) {
      if (!recording) return;
      past.push(entry);
      // A new action makes the redo stack meaningless: you cannot replay a
      // future that no longer follows from here.
      future.length = 0;
    },
    undo() {
      const entry = past.pop();
      if (!entry) return false;
      run(entry.undo);
      future.push(entry);
      return true;
    },
    redo() {
      const entry = future.pop();
      if (!entry) return false;
      run(entry.redo);
      past.push(entry);
      return true;
    },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
  };
}
