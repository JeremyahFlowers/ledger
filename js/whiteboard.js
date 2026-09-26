// The drawing surface.
//
// Pointer events throughout, so a trackpad, a finger and an Apple Pencil take
// the same code path. What is on the board lives in board.js as plain data in
// logical coordinates; this file is the canvas, the tools and the gestures.
//
// Everything is kept as elements rather than pixels, which is what lets undo
// replay rather than snapshot, lets a drawing move between devices at the right
// size, and lets anything be selected, resized and re-edited after it is drawn.
//
// Rebuilt after "it really doesn't feel useable", against what Figma, draw.io
// and Excalidraw do, because those conventions are already in people's hands:
//
//  * Anything placed can be picked up again — moved, resized from eight grips,
//    recoloured, retyped. Previously a shape was final the moment you let go.
//  * Text is a real text box edited in place. It was a browser prompt(): one
//    line, no size of its own, no way to correct a typo, and a modal dialog
//    between you and the board. The editor here is a textarea laid over the
//    canvas, which is what makes every typing convention — selection, word
//    jumps, undo inside the field, an IME, a tablet's own keyboard and
//    autocorrect — work without any of it being reimplemented badly.
//  * An eraser, because undo only removes what you did last and the thing you
//    want gone is usually not that.
//  * Pan and zoom, because a fixed scale on a tablet means the detail you can
//    draw is whatever your finger manages at arm's length.
//  * Drawing a shape returns you to the select tool with the shape selected,
//    so the usual next thing — move it, size it, label it — is one gesture
//    away rather than a trip back to the toolbar.
//
// The tools are still chosen for what a coding interview needs drawn. An array
// with index labels is one drag, because it is the most-drawn thing in an
// interview and the most tedious freehand. There is no fill, no layers and no
// gradients: none of them appear on a whiteboard in front of an interviewer.

import {
  BOARD_WIDTH, MIN_SIZE, MIN_ZOOM, MAX_ZOOM, DEFAULT_FONT_SIZE, LINE_HEIGHT,
  makeElement, toBoard, toScreen, zoomAt, panBy,
  elementBounds, boundsOf, normalizeBounds, elementAt, movedBy,
  handlePositions, handleAt, resizeBounds, scaleElement,
  snapToAngle, cellLines, cellLabels, createHistory,
  wrapText, fitTextBox, migrateBoard, migrateElement,
} from "./board.js";

const COLORS = ["#e7efeb", "#4fc3b8", "#e0a257", "#e2827c", "#7ed9cf"];

/** Monospace on purpose. It is the font an interview board is full of, and it
 *  is also what keeps the canvas and the overlaid editor wrapping identically:
 *  with a fixed advance width the two measure every string the same. */
const FONT_STACK = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

const FONT_SIZES = { min: 8, max: 120, step: 4 };

/** Tool, keyboard shortcut, and what it makes. The letters follow the
 *  convention every drawing tool shares, so they are already known. */
const TOOLS = [
  { key: "v", id: "select", label: "Select", glyph: "↖" },
  { key: "h", id: "hand", label: "Pan", glyph: "✋" },
  { key: "p", id: "pen", label: "Pen", glyph: "✎" },
  { key: "e", id: "eraser", label: "Eraser", glyph: "⌫" },
  { key: "a", id: "arrow", label: "Arrow", glyph: "→" },
  { key: "l", id: "line", label: "Line", glyph: "╱" },
  { key: "r", id: "rect", label: "Box", glyph: "▭" },
  { key: "o", id: "ellipse", label: "Circle", glyph: "◯" },
  { key: "t", id: "text", label: "Text", glyph: "T" },
  { key: "g", id: "cells", label: "Array", glyph: "▦" },
];

/** Tools that place one thing and hand you back the select tool with it
 *  selected. Pen and eraser are excluded because they are used in strokes,
 *  and being thrown out of them after every mark would be maddening. */
const ONE_SHOT = new Set(["arrow", "line", "rect", "ellipse", "cells", "text"]);

/** Arrows are straightened by default. The reason to reach for an arrow tool
 *  rather than freehand is that it comes out straight; a wobbly one between two
 *  boxes reads as a mistake rather than as a pointer. */
const SNAP_BY_DEFAULT = new Set(["arrow", "line"]);

/** Tools that draw a shape by dragging a box. */
const DRAG_TOOLS = new Set(["arrow", "line", "rect", "ellipse", "cells"]);

/** A grip is this many screen pixels across however far the board is zoomed —
 *  a grab area that shrank as you zoomed out would become unusable exactly
 *  when the shape was already small. */
const HANDLE_PX = 9;
/** Wider on a finger, which has no pixel to be precise about. */
const TOUCH_SLOP_PX = 22;
const MOUSE_SLOP_PX = 9;
const ERASER_PX = 14;

/** How far a pointer may travel and still count as a tap rather than a drag. */
const TAP_PX = 4;

const cssVar = (root, name, fallback) =>
  (getComputedStyle(root).getPropertyValue(name) || "").trim() || fallback;

/**
 * @param {object} hooks  onAdd / onUpdate / onRemove / onClear, and `readOnly`.
 *
 * Read-only exists so the interviewer's page draws the board with this code
 * rather than a second copy of it. Two renderers for one drawing would drift,
 * and the first time anyone noticed would be an interview where the two screens
 * disagreed about what had been drawn.
 */
export function createWhiteboard(root, hooks = {}) {
  const readOnly = !!hooks.readOnly;
  const { onAdd = null, onUpdate = null, onRemove = null, onClear = null } = hooks;

  root.innerHTML = `
    ${readOnly ? "" : `<div class="whiteboard-toolbar">
      <div class="wb-tools" role="toolbar" aria-label="Drawing tools">
        ${TOOLS.map((t) => `<button type="button" class="wb-tool" data-tool="${t.id}"
          title="${t.label} — ${t.key.toUpperCase()}" aria-label="${t.label}"
          aria-pressed="${t.id === "pen"}">${t.glyph}</button>`).join("")}
      </div>
      <div class="wb-sep" role="separator"></div>
      <div class="wb-colors" role="group" aria-label="Colour">
        ${COLORS.map((c, i) => `<button type="button" class="wb-color${i === 0 ? " active" : ""}"
          data-color="${c}" style="background:${c}" aria-label="Colour ${i + 1}"
          aria-pressed="${i === 0}"></button>`).join("")}
      </div>
      <label class="wb-width-label" data-prop="stroke">Stroke
        <input type="range" id="wb-width" min="1" max="12" value="3" aria-label="Stroke width" />
      </label>
      <div class="wb-size" data-prop="font" hidden>
        <button type="button" class="wb-step" id="wb-font-down" aria-label="Smaller text">A&minus;</button>
        <input type="number" id="wb-font" class="wb-size-input" value="${DEFAULT_FONT_SIZE}"
          min="${FONT_SIZES.min}" max="${FONT_SIZES.max}" step="1" aria-label="Text size" />
        <button type="button" class="wb-step" id="wb-font-up" aria-label="Bigger text">A+</button>
      </div>
      <div class="wb-spacer"></div>
      <button type="button" class="btn btn-ghost btn-sm" id="wb-undo" title="Undo — Cmd/Ctrl-Z">Undo</button>
      <button type="button" class="btn btn-ghost btn-sm" id="wb-redo" title="Redo — Cmd/Ctrl-Shift-Z">Redo</button>
      <button type="button" class="btn btn-ghost btn-sm" id="wb-clear">Clear</button>
    </div>`}
    <div class="wb-stage">
      <canvas class="whiteboard-canvas" id="wb-canvas" ${readOnly ? "" : 'tabindex="0"'}></canvas>
      ${readOnly ? "" : `<textarea class="wb-text-editor" id="wb-editor" hidden spellcheck="false"
        aria-label="Text"></textarea>
      <div class="wb-zoom" role="group" aria-label="Zoom">
        <button type="button" class="wb-step" id="wb-zoom-out" aria-label="Zoom out">&minus;</button>
        <button type="button" class="wb-zoom-level" id="wb-zoom-level"
          title="Fit everything — Cmd/Ctrl-0">100%</button>
        <button type="button" class="wb-step" id="wb-zoom-in" aria-label="Zoom in">+</button>
      </div>`}
    </div>`;

  const stage = root.querySelector(".wb-stage");
  const canvas = root.querySelector("#wb-canvas");
  const editor = root.querySelector("#wb-editor");
  const ctx = canvas.getContext("2d");

  let elements = [];
  let tool = "pen";
  let color = COLORS[0];
  let width = 3;
  let fontSize = DEFAULT_FONT_SIZE;
  let view = { scale: 1, x: 0, y: 0 };

  let drafting = null;      // the element being drawn right now
  let selectedId = null;
  let action = null;        // { type: "move" | "resize" | "pan" | "erase", ... }
  let editing = null;       // { id, before, created }
  let hoverHandle = null;
  let spaceHeld = false;
  let localSeq = 0;

  // Live pointers, so a second finger can be told from a second click. Without
  // this a pinch is read as a second pen stroke, which on a tablet is most of
  // what makes a board feel broken.
  const pointers = new Map();
  let gesture = null;       // { distance, mid }

  // A stack of reversible steps rather than a stack of board states: a board is
  // unbounded and a step is two functions. Its mechanics live in board.js,
  // where they can be tested without a canvas — which is where its one real bug
  // hid until they were.
  const history = createHistory();

  const nextId = () => `e${localSeq++}-${Math.random().toString(36).slice(2, 8)}`;
  const rectWidth = () => canvas.getBoundingClientRect().width || 1;
  /** Screen pixels per board unit, at the current zoom. */
  const pxPerUnit = () => (rectWidth() / BOARD_WIDTH) * view.scale;
  /** A screen distance in board units — for grips and slop, which are sized in
   *  pixels so they stay the same size on screen at any zoom. */
  const inUnits = (px) => px / (pxPerUnit() || 1);
  const slopFor = (e) => inUnits(e?.pointerType === "touch" ? TOUCH_SLOP_PX : MOUSE_SLOP_PX);

  /** A pointer event in board units. */
  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    return toBoard({ x: e.clientX - rect.left, y: e.clientY - rect.top }, rect.width, view);
  }
  const localPoint = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const selected = () => elements.find((e) => e.id === selectedId) || null;

  // ---- measuring text ----

  /** Width of a string at a given size, in board units. The canvas is the only
   *  thing that knows the font's metrics, so board.js takes this as an
   *  argument rather than guessing. */
  const measurerFor = (size) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${size}px ${FONT_STACK}`;
    const advance = ctx.measureText("0123456789").width / 10;
    ctx.restore();
    return (s) => s.length * advance;
  };
  const linesOf = (el) => {
    const b = elementBounds(el);
    const size = el.fontSize || DEFAULT_FONT_SIZE;
    return wrapText(el.text, Math.max(MIN_SIZE, b ? b.w : MIN_SIZE), measurerFor(size));
  };
  const refit = (el) => fitTextBox(el, measurerFor(el.fontSize || DEFAULT_FONT_SIZE));

  // ---- the canvas surface ----

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    positionEditor();
    redraw();
  }

  function redraw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = cssVar(root, "--surface-alt", "#1c2723");
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // One transform for everything, so every draw function below works in board
    // units and none of them has to know about pixels, device ratios or pan.
    const dpr = window.devicePixelRatio || 1;
    const k = (canvas.width / dpr / BOARD_WIDTH) * view.scale * dpr;
    ctx.setTransform(k, 0, 0, k, -view.x * k, -view.y * k);

    const erasing = action?.type === "erase" ? action.marked : null;
    for (const el of elements) {
      if (editing && el.id === editing.id) continue;   // the editor is showing it
      ctx.globalAlpha = erasing?.has(el.id) ? 0.25 : 1;
      draw(el);
      ctx.globalAlpha = 1;
    }
    if (drafting) draw(drafting);

    const sel = selected();
    if (sel && !editing) drawSelection(sel);
  }

  function setStroke(el) {
    ctx.strokeStyle = el.color;
    ctx.lineWidth = el.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  function draw(el) {
    const pts = el.points || [];
    if (!pts.length) return;
    setStroke(el);

    switch (el.kind) {
      case "pen": {
        if (pts.length < 2) {
          // A dot is a legitimate mark, and a zero-length path draws nothing.
          ctx.beginPath();
          ctx.arc(pts[0].x, pts[0].y, Math.max(0.6, el.width / 2), 0, Math.PI * 2);
          ctx.fillStyle = el.color;
          ctx.fill();
          break;
        }
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        // Quadratic through the midpoints: a polyline of raw pointer samples
        // has a visible corner at every one of them, which is what makes a
        // freehand stroke look like a graph rather than a line.
        for (let i = 1; i < pts.length - 1; i++) {
          const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
        break;
      }
      case "line":
      case "arrow": {
        if (pts.length < 2) break;
        const [a, b] = [pts[0], pts[pts.length - 1]];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (el.kind === "arrow") drawHead(a, b, el);
        break;
      }
      case "rect": {
        const b = elementBounds(el);
        // A rounded corner is what every one of these tools draws, and it is
        // the difference between a diagram and a spreadsheet.
        const r = Math.min(6, b.w / 4, b.h / 4);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(b.x, b.y, b.w, b.h, r);
        else ctx.rect(b.x, b.y, b.w, b.h);
        ctx.stroke();
        break;
      }
      case "ellipse": {
        const b = elementBounds(el);
        if (b.w <= 0 || b.h <= 0) break;
        ctx.beginPath();
        ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "text": {
        const b = elementBounds(el);
        const size = el.fontSize || DEFAULT_FONT_SIZE;
        ctx.fillStyle = el.color;
        ctx.font = `${size}px ${FONT_STACK}`;
        ctx.textBaseline = "top";
        linesOf(el).forEach((line, i) => {
          ctx.fillText(line, b.x, b.y + i * size * LINE_HEIGHT + size * (LINE_HEIGHT - 1) / 2);
        });
        break;
      }
      case "cells": {
        for (const [a, b] of cellLines(el)) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        // Index labels under a single row. An array without indices is a row of
        // boxes; with them it is the thing you are actually reasoning about.
        ctx.fillStyle = el.color;
        ctx.globalAlpha *= 0.65;
        ctx.font = `${el.width * 4}px ${FONT_STACK}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        for (const label of cellLabels(el)) ctx.fillText(String(label.index), label.x, label.y);
        ctx.globalAlpha = action?.type === "erase" && action.marked.has(el.id) ? 0.25 : 1;
        ctx.textAlign = "start";
        break;
      }
    }
  }

  function drawHead(from, to, el) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const size = Math.max(10, el.width * 3.5);
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - size * Math.cos(angle - 0.4), to.y - size * Math.sin(angle - 0.4));
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - size * Math.cos(angle + 0.4), to.y - size * Math.sin(angle + 0.4));
    ctx.stroke();
  }

  /** The dashed box and its grips. Everything here is sized in screen pixels
   *  converted to board units, so the chrome stays one size however far the
   *  board is zoomed — grips that scaled with the drawing would be unusable at
   *  both ends of the range. */
  function drawSelection(el) {
    const b = elementBounds(el);
    if (!b) return;
    const pad = inUnits(5);
    const outline = normalizeBounds({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 });
    const hair = inUnits(1.25);
    const accent = cssVar(root, "--accent", "#4fc3b8");

    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = hair;
    ctx.setLineDash([inUnits(5), inUnits(4)]);
    ctx.strokeRect(outline.x, outline.y, outline.w, outline.h);
    ctx.setLineDash([]);

    const r = inUnits(HANDLE_PX) / 2;
    ctx.fillStyle = cssVar(root, "--surface", "#16201c");
    ctx.lineWidth = hair * 1.4;
    for (const h of handlePositions(b, el)) {
      ctx.beginPath();
      ctx.rect(h.x - r, h.y - r, r * 2, r * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- changing what is on the board ----

  function add(el) {
    elements.push(el);
    history.record({ undo: () => removeById(el.id), redo: () => add(el) });
    redraw();
    onAdd?.(el);
  }

  function removeById(id) {
    const i = elements.findIndex((e) => e.id === id);
    if (i < 0) return;
    const [gone] = elements.splice(i, 1);
    if (selectedId === id) selectedId = null;
    history.record({ undo: () => add(gone), redo: () => removeById(id) });
    redraw();
    onRemove?.(id);
  }

  /** Several at once, as one step. An eraser dragged across six strokes is one
   *  thing the hand did, so it is one thing Undo puts back — and it puts them
   *  back where they were in the stack rather than on top of it, because for
   *  overlapping marks the order is part of the picture. */
  function removeMany(ids) {
    if (!ids.size) return;
    const before = elements.slice();
    const going = before.filter((e) => ids.has(e.id));
    if (!going.length) return;
    elements = before.filter((e) => !ids.has(e.id));
    if (ids.has(selectedId)) selectedId = null;
    history.record({
      undo: () => {
        elements = before.slice();
        redraw();
        going.forEach((el) => onAdd?.(el));
      },
      redo: () => {
        elements = elements.filter((e) => !ids.has(e.id));
        selectedId = null;
        redraw();
        ids.forEach((id) => onRemove?.(id));
      },
    });
    redraw();
    ids.forEach((id) => onRemove?.(id));
  }

  function replace(el) {
    const i = elements.findIndex((e) => e.id === el.id);
    if (i < 0) return;
    const before = elements[i];
    elements[i] = el;
    history.record({ undo: () => replace(before), redo: () => replace(el) });
    redraw();
    onUpdate?.(el);
  }

  /** Change without recording a step — for the middle of a drag or a keystroke,
   *  where the step is recorded once at the end. */
  function put(el) {
    const i = elements.findIndex((e) => e.id === el.id);
    if (i >= 0) elements[i] = el;
  }

  const undo = () => { commitEditor(); history.undo(); syncProps(); redraw(); };
  const redo = () => { commitEditor(); history.redo(); syncProps(); redraw(); };

  // ---- text, edited where it sits ----

  /**
   * Open the text editor over an element.
   *
   * A textarea laid on the canvas rather than a caret drawn into it. Every
   * typing convention anyone has — arrow keys, word jumps, shift-selection,
   * select-all, copy and paste, undo within the field, an IME, a tablet's own
   * keyboard and its autocorrect — already works in a textarea, and every one
   * of them would have to be reimplemented, badly, to draw a caret instead.
   * The previous board asked for a line of text through window.prompt(), which
   * is a modal dialog between you and the drawing and cannot be re-opened to
   * fix a typo.
   */
  function openEditor(el, { created = false } = {}) {
    if (readOnly) return;
    commitEditor();
    editing = { id: el.id, before: el, created };
    selectedId = el.id;
    editor.value = el.text || "";
    editor.hidden = false;
    positionEditor();
    redraw();
    // After paint, or the caret lands before the box has its size and the
    // view scrolls to the wrong place.
    requestAnimationFrame(() => {
      editor.focus({ preventScroll: true });
      const end = editor.value.length;
      editor.setSelectionRange(end, end);
    });
  }

  /** Lay the editor exactly over where the glyphs will be drawn, at the size
   *  they will be drawn, so committing does not make the words jump. */
  function positionEditor() {
    if (!editing || editor.hidden) return;
    const el = elements.find((e) => e.id === editing.id);
    if (!el) return;
    const b = elementBounds(el);
    const k = pxPerUnit();
    const tl = toScreen({ x: b.x, y: b.y }, rectWidth(), view);
    const size = (el.fontSize || DEFAULT_FONT_SIZE) * k;
    Object.assign(editor.style, {
      left: `${tl.x}px`,
      top: `${tl.y}px`,
      width: `${Math.max(MIN_SIZE, b.w) * k}px`,
      height: `${Math.max(size * LINE_HEIGHT, b.h * k)}px`,
      font: `${size}px ${FONT_STACK}`,
      lineHeight: String(LINE_HEIGHT),
      color: el.color,
      caretColor: el.color,
    });
  }

  /** Grow the element to fit what has been typed, live, so the box you can see
   *  is the box you will get. Recorded as one step when the editor closes. */
  function onEditorInput() {
    if (!editing) return;
    const el = elements.find((e) => e.id === editing.id);
    if (!el) return;
    put(refit({ ...el, text: editor.value }));
    positionEditor();
    redraw();
  }

  function commitEditor() {
    if (!editing) return;
    const { id, before, created } = editing;
    editing = null;
    editor.hidden = true;
    const el = elements.find((e) => e.id === id);
    if (!el) { redraw(); return; }

    const text = editor.value;
    // An empty box is invisible and unclickable, so there would be no way to
    // get rid of it or get back into it. Typing nothing means you changed your
    // mind, and changing your mind should leave no trace.
    if (!text.trim()) {
      elements = elements.filter((e) => e.id !== id);
      if (selectedId === id) selectedId = null;
      if (!created) {
        history.record({ undo: () => add(before), redo: () => removeById(id) });
        onRemove?.(id);
      }
      redraw();
      return;
    }

    const next = refit({ ...el, text });
    put(before);              // put it back, so replace() records a real step
    if (created) {
      elements = elements.filter((e) => e.id !== id);
      add(next);
    } else {
      replace(next);
    }
    selectedId = next.id;
    redraw();
  }

  /** A new text box at a point, opened for typing straight away. Its width is
   *  a comfortable measure rather than nothing, so the first word does not
   *  wrap after one character. */
  function startTextAt(at) {
    const w = Math.max(120, BOARD_WIDTH / 5);
    const el = makeElement("text", {
      id: nextId(), color, width, fontSize,
      points: [{ x: at.x, y: at.y }, { x: at.x + w, y: at.y + fontSize * LINE_HEIGHT }],
      text: "",
    });
    elements.push(el);
    openEditor(el, { created: true });
  }

  if (!readOnly) {
    editor.addEventListener("input", onEditorInput);
    editor.addEventListener("blur", commitEditor);
    editor.addEventListener("keydown", (e) => {
      // Escape commits and gets out. Return makes a new line, which is the
      // whole point of a text area rather than a prompt. Cmd/Ctrl-Return also
      // commits, for anyone who expects a form.
      if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        e.stopPropagation();
        commitEditor();
        canvas.focus({ preventScroll: true });
        return;
      }
      // Everything else belongs to the textarea, including the shortcuts the
      // board would otherwise claim — a "t" typed into a label must not switch
      // tools, and Cmd-Z must undo the typing, not the drawing.
      e.stopPropagation();
    });
  }

  // ---- pointers ----

  canvas.style.touchAction = "none";

  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  /** The cursor says what the next press will do, which is most of how a board
   *  teaches itself without a manual. */
  const HANDLE_CURSOR = {
    nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
    n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
  };
  function updateCursor(at, e) {
    if (readOnly) return;
    if (action?.type === "pan" || tool === "hand" || spaceHeld) {
      canvas.style.cursor = action?.type === "pan" ? "grabbing" : "grab";
      return;
    }
    if (tool === "eraser") { canvas.style.cursor = "cell"; return; }
    if (tool !== "select") { canvas.style.cursor = "crosshair"; return; }
    const sel = selected();
    if (sel && at) {
      const h = handleAt(elementBounds(sel), at, slopFor(e), sel);
      hoverHandle = h;
      if (h) { canvas.style.cursor = HANDLE_CURSOR[h]; return; }
    }
    canvas.style.cursor = at && elementAt(elements, at, slopFor(e)) ? "move" : "default";
  }

  /** Everything the eraser passed over, including between two samples — a fast
   *  swipe reports a handful of points metres apart and would otherwise erase
   *  only where they happened to land. */
  function markErased(from, to) {
    const marked = action.marked;
    const slop = inUnits(ERASER_PX);
    const steps = Math.max(1, Math.ceil(distance(from, to) / Math.max(1, slop)));
    for (let i = 0; i <= steps; i++) {
      const p = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
      const hit = elementAt(elements, p, slop);
      if (hit) marked.add(hit.id);
    }
  }

  function onPointerDown(e) {
    if (readOnly) return;
    const local = localPoint(e);
    pointers.set(e.pointerId, local);

    // A second finger is a gesture, never a second stroke. Whatever the first
    // one had started is abandoned rather than left half-drawn on the board —
    // including a text box, which the first finger opens the moment it lands
    // while the text tool is in hand. Left open it draws its own outline over
    // the drawing, and because a board that is being typed into reports itself
    // as busy, it would also stop the session syncing until something else
    // happened to close it.
    if (pointers.size === 2) {
      commitEditor();
      drafting = null;
      action = null;
      const [a, b] = [...pointers.values()];
      gesture = { distance: distance(a, b), mid: midpoint(a, b) };
      redraw();
      return;
    }
    if (pointers.size > 2) return;

    // Capture can be refused — a pointer the browser no longer considers down,
    // a synthetic event — and a throw here would abort the press before any
    // tool had seen it.
    try { canvas.setPointerCapture?.(e.pointerId); } catch (_) { /* not fatal */ }
    if (editing) commitEditor();
    canvas.focus?.({ preventScroll: true });
    const at = pointFromEvent(e);

    // Middle button, space, or the hand tool: the three ways every drawing app
    // lets you shove the canvas around without changing tools.
    if (e.button === 1 || spaceHeld || tool === "hand") {
      action = { type: "pan", last: local };
      updateCursor(at, e);
      return;
    }

    if (tool === "eraser") {
      action = { type: "erase", marked: new Set(), last: at };
      markErased(at, at);
      redraw();
      return;
    }

    if (tool === "select") {
      const sel = selected();
      if (sel) {
        const handle = handleAt(elementBounds(sel), at, slopFor(e), sel);
        if (handle) {
          action = { type: "resize", id: sel.id, handle, start: elementBounds(sel), origin: sel };
          return;
        }
      }
      const hit = elementAt(elements, at, slopFor(e));
      selectedId = hit ? hit.id : null;
      action = hit ? { type: "move", id: hit.id, from: at, origin: hit, moved: false } : null;
      syncProps();
      redraw();
      return;
    }

    if (tool === "text") { startTextAt(at); return; }

    drafting = makeElement(tool, {
      id: nextId(), color, width, fontSize,
      points: tool === "pen" ? [at] : [at, at],
      ...(tool === "cells" ? { cols: 8, rows: 1 } : {}),
    });
    redraw();
  }

  function onPointerMove(e) {
    if (readOnly) return;
    const local = localPoint(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, local);

    if (gesture && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = distance(a, b);
      const m = midpoint(a, b);
      if (gesture.distance > 0) view = zoomAt(view, m, d / gesture.distance, rectWidth());
      view = panBy(view, m.x - gesture.mid.x, m.y - gesture.mid.y, rectWidth());
      gesture = { distance: d, mid: m };
      showZoom();
      positionEditor();
      redraw();
      return;
    }

    const at = pointFromEvent(e);

    if (action?.type === "pan") {
      view = panBy(view, local.x - action.last.x, local.y - action.last.y, rectWidth());
      action.last = local;
      showZoom();
      positionEditor();
      redraw();
      return;
    }

    if (action?.type === "erase") {
      markErased(action.last, at);
      action.last = at;
      redraw();
      return;
    }

    if (action?.type === "move") {
      const dx = at.x - action.from.x;
      const dy = at.y - action.from.y;
      if (!action.moved && Math.hypot(dx, dy) * pxPerUnit() < TAP_PX) return;
      action.moved = true;
      put(movedBy(action.origin, dx, dy));
      redraw();
      return;
    }

    if (action?.type === "resize") {
      const box = resizeBounds(action.start, action.handle, at, { keepAspect: e.shiftKey });
      let next = scaleElement(action.origin, action.start, box);
      if (next.kind === "text") next = refit(next);
      put(next);
      positionEditor();
      redraw();
      return;
    }

    if (drafting) {
      if (drafting.kind === "pen") drafting.points.push(at);
      else {
        const from = drafting.points[0];
        if (SNAP_BY_DEFAULT.has(drafting.kind)) {
          drafting.points[1] = e.shiftKey ? at : snapToAngle(from, at);
        } else if (e.shiftKey) {
          // Square and circle, the way every drawing app spells them.
          const side = Math.max(Math.abs(at.x - from.x), Math.abs(at.y - from.y));
          drafting.points[1] = {
            x: from.x + Math.sign(at.x - from.x || 1) * side,
            y: from.y + Math.sign(at.y - from.y || 1) * side,
          };
        } else {
          drafting.points[1] = at;
        }
        // An array sizes its cells to the drag, so eight of them is one gesture
        // rather than a number typed into a field.
        if (drafting.kind === "cells") {
          const b = elementBounds(drafting);
          drafting.cols = Math.max(1, Math.round(b.w / Math.max(MIN_SIZE, b.h || MIN_SIZE)));
        }
      }
      redraw();
      return;
    }

    updateCursor(at, e);
  }

  function onPointerUp(e) {
    if (readOnly) return;
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture?.(e.pointerId); } catch (_) { /* already gone */ }

    if (gesture) {
      if (pointers.size < 2) gesture = null;
      return;
    }

    if (action) {
      const { type } = action;
      if (type === "erase") {
        const marked = action.marked;
        action = null;
        removeMany(marked);
      } else if ((type === "move" || type === "resize")) {
        const final = elements.find((x) => x.id === action.id);
        const origin = action.origin;
        const changed = type === "resize" || action.moved;
        action = null;
        if (final && changed) {
          put(origin);          // back to where it was, so replace() records a real step
          replace(final);
        }
      } else {
        action = null;
      }
      updateCursor(null, e);
      redraw();
      return;
    }

    if (!drafting) return;
    const el = drafting;
    drafting = null;

    // A tap with no drag is not a shape. Pen keeps single points, because a dot
    // is a legitimate mark.
    const b = elementBounds(el);
    const tiny = b && b.w * pxPerUnit() < TAP_PX && b.h * pxPerUnit() < TAP_PX;
    if (el.kind !== "pen" && tiny) { redraw(); return; }
    add(el);
    if (ONE_SHOT.has(el.kind)) {
      // Handed back the select tool with the new shape already selected, so
      // moving, sizing or recolouring it is the next gesture rather than the
      // next trip to the toolbar.
      selectedId = el.id;
      setTool("select");
    }
    redraw();
  }

  function onDoubleClick(e) {
    if (readOnly || tool === "hand" || tool === "eraser") return;
    const at = pointFromEvent(e);
    const hit = elementAt(elements, at, slopFor(e));
    if (hit?.kind === "text") { openEditor(hit); return; }
    // Double-click on empty board starts a label, which is how every diagram
    // tool does it and is faster than going to get the text tool.
    if (!hit && tool === "select") startTextAt(at);
  }

  /**
   * Wheel: scroll to pan, pinch or Cmd-scroll to zoom.
   *
   * A trackpad pinch reaches the page as a wheel event with ctrlKey set, which
   * is the only way to tell one from a two-finger scroll, and is why the check
   * is on the modifier rather than on the pointer type.
   */
  function onWheel(e) {
    if (readOnly) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      view = zoomAt(view, localPoint(e), Math.exp(-e.deltaY / 120), rectWidth());
    } else {
      view = panBy(view, -e.deltaX, -e.deltaY, rectWidth());
    }
    showZoom();
    positionEditor();
    redraw();
  }

  // ---- keyboard ----

  function nudge(dx, dy) {
    const sel = selected();
    if (!sel) return;
    replace(movedBy(sel, dx, dy));
  }

  function duplicate() {
    const sel = selected();
    if (!sel) return;
    const offset = 12;
    const copy = { ...sel, id: nextId(), points: sel.points.map((p) => ({ x: p.x + offset, y: p.y + offset })) };
    add(copy);
    selectedId = copy.id;
    setTool("select");
    redraw();
  }

  function onKeyDown(e) {
    if (readOnly) return;
    if (e.key === " " && !spaceHeld) {
      spaceHeld = true;
      updateCursor(null, e);
      e.preventDefault();
      return;
    }
    const meta = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (meta && key === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (meta && key === "d") { e.preventDefault(); duplicate(); return; }
    if (meta && key === "0") { e.preventDefault(); zoomToFit(); return; }

    if ((e.key === "Backspace" || e.key === "Delete") && selectedId) {
      e.preventDefault();
      removeById(selectedId);
      return;
    }
    if (e.key === "Escape") { selectedId = null; syncProps(); redraw(); return; }
    // Return opens whatever is selected for editing, which for a label is the
    // thing you most often want and for anything else does nothing.
    if (e.key === "Enter" && selected()?.kind === "text") {
      e.preventDefault();
      openEditor(selected());
      return;
    }

    const NUDGE = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (NUDGE[e.key] && selectedId) {
      e.preventDefault();
      const [dx, dy] = NUDGE[e.key];
      const step = e.shiftKey ? 10 : 1;
      nudge(dx * step, dy * step);
      return;
    }

    if (meta) return;
    const match = TOOLS.find((t) => t.key === key);
    if (match) { e.preventDefault(); setTool(match.id); }
  }

  function onKeyUp(e) {
    if (e.key === " ") { spaceHeld = false; updateCursor(null, e); }
  }

  /** A release anywhere, for the pointers the canvas did not hear end. */
  function onWindowPointerEnd(e) {
    if (readOnly || !pointers.has(e.pointerId)) return;
    onPointerUp(e);
  }

  // ---- the toolbar ----

  function setTool(id) {
    commitEditor();
    tool = id;
    // Switching away from Select drops the selection, because its grips would
    // otherwise sit on the board catching presses meant for the new tool.
    // Switching *to* it keeps whatever is selected — that is how a shape stays
    // selected after it is drawn.
    if (id !== "select") selectedId = null;
    root.querySelectorAll(".wb-tool").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.tool === id)));
    syncProps();
    updateCursor(null, null);
    redraw();
  }

  /** Show the property that applies to what is in hand. A stroke width means
   *  nothing to a paragraph and a type size means nothing to a box, and a
   *  toolbar showing both at once is a toolbar nobody reads. */
  function syncProps() {
    if (readOnly) return;
    const sel = selected();
    const textish = tool === "text" || sel?.kind === "text";
    root.querySelector('[data-prop="stroke"]')?.toggleAttribute("hidden", textish);
    root.querySelector('[data-prop="font"]')?.toggleAttribute("hidden", !textish);
    const size = sel?.kind === "text" ? sel.fontSize || DEFAULT_FONT_SIZE : fontSize;
    const input = root.querySelector("#wb-font");
    if (input && document.activeElement !== input) input.value = String(Math.round(size));
    const range = root.querySelector("#wb-width");
    if (range && sel && sel.kind !== "text") range.value = String(sel.width);
    root.querySelectorAll(".wb-color").forEach((b) => {
      const on = b.dataset.color === (sel ? sel.color : color);
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  function setFontSize(next) {
    fontSize = Math.max(FONT_SIZES.min, Math.min(FONT_SIZES.max, Math.round(next)));
    const sel = selected();
    if (sel?.kind === "text") replace(refit({ ...sel, fontSize }));
    if (editing) positionEditor();
    syncProps();
    redraw();
  }

  // ---- zoom ----

  function showZoom() {
    const label = root.querySelector("#wb-zoom-level");
    if (label) label.textContent = `${Math.round(view.scale * 100)}%`;
  }

  function zoomBy(factor) {
    const rect = canvas.getBoundingClientRect();
    view = zoomAt(view, { x: rect.width / 2, y: rect.height / 2 }, factor, rect.width);
    showZoom();
    positionEditor();
    redraw();
  }

  /** Frame everything that has been drawn, or go back to 100% on an empty
   *  board. The one control that always gets you un-lost. */
  function zoomToFit() {
    const rect = canvas.getBoundingClientRect();
    const b = boundsOf(elements);
    if (!b || b.w <= 0 || rect.width <= 0) {
      view = { scale: 1, x: 0, y: 0 };
    } else {
      const pad = 40;
      const unit = rect.width / BOARD_WIDTH;
      const heightInUnits = (rect.height / unit) || 1;
      const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM,
        Math.min((BOARD_WIDTH - pad * 2) / b.w, (heightInUnits - pad * 2 / unit) / Math.max(b.h, 1))));
      const seenW = BOARD_WIDTH / scale;
      const seenH = heightInUnits / scale;
      view = { scale, x: b.x + b.w / 2 - seenW / 2, y: b.y + b.h / 2 - seenH / 2 };
    }
    showZoom();
    positionEditor();
    redraw();
  }

  if (!readOnly) {
    root.querySelectorAll(".wb-tool").forEach((btn) => {
      btn.addEventListener("click", () => setTool(btn.dataset.tool));
    });
    root.querySelectorAll(".wb-color").forEach((btn) => {
      btn.addEventListener("click", () => {
        color = btn.dataset.color;
        // Recolours the selection, which is what clicking a colour with
        // something selected obviously means.
        const sel = selected();
        if (sel) replace({ ...sel, color });
        if (editing) positionEditor();
        syncProps();
      });
    });
    root.querySelector("#wb-width")?.addEventListener("input", (e) => {
      width = Number(e.target.value);
      const sel = selected();
      if (sel && sel.kind !== "text") replace({ ...sel, width });
    });
    root.querySelector("#wb-font")?.addEventListener("input", (e) => {
      const n = Number(e.target.value);
      if (Number.isFinite(n) && n > 0) setFontSize(n);
    });
    root.querySelector("#wb-font-down")?.addEventListener("click", () => setFontSize(fontSize - FONT_SIZES.step));
    root.querySelector("#wb-font-up")?.addEventListener("click", () => setFontSize(fontSize + FONT_SIZES.step));
    root.querySelector("#wb-zoom-in")?.addEventListener("click", () => zoomBy(1.25));
    root.querySelector("#wb-zoom-out")?.addEventListener("click", () => zoomBy(0.8));
    root.querySelector("#wb-zoom-level")?.addEventListener("click", zoomToFit);
    root.querySelector("#wb-undo")?.addEventListener("click", undo);
    root.querySelector("#wb-redo")?.addEventListener("click", redo);
    root.querySelector("#wb-clear")?.addEventListener("click", () => {
      commitEditor();
      if (!elements.length) return;
      const previous = elements;
      elements = [];
      selectedId = null;
      // Undoing a clear puts the whole board back at once, and the caller is
      // told both ways — a clear on one device that could not be undone on the
      // other would leave the two permanently different.
      history.record({
        undo: () => { elements = previous; redraw(); previous.forEach((el) => onAdd?.(el)); },
        redo: () => { elements = []; redraw(); onClear?.(); },
      });
      redraw();
      onClear?.();
    });

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    // A backstop for a release the canvas never hears about: capture refused,
    // a finger lifted over browser chrome, a system dialog taking the pointer.
    // Without it that pointer stays in the map for ever, and because two live
    // pointers mean a pinch, the *next* touch is read as a second finger and
    // the board quietly stops drawing. It is not a hypothetical — it is what
    // one dropped pointerup did during testing, and it looks exactly like the
    // board being broken.
    window.addEventListener("pointerup", onWindowPointerEnd);
    window.addEventListener("pointercancel", onWindowPointerEnd);
    canvas.addEventListener("pointerleave", (e) => { if (!pointers.has(e.pointerId)) updateCursor(null, e); });
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("keyup", onKeyUp);
  }

  // A pane dragged narrower by a splitter changes the canvas's size without
  // the window's, and a canvas whose backing store is the wrong size draws
  // everything stretched. The old board listened only for window resizes,
  // which is why the workspace splitters distorted it.
  const observer = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => resize())
    : null;
  observer?.observe(canvas);
  window.addEventListener("resize", resize);
  resize();
  showZoom();
  syncProps();

  return {
    toJSON: () => elements.map((el) => ({ ...el, points: el.points.map((p) => ({ ...p })) })),

    /** True while something is being drawn, dragged, resized or typed. A caller
     *  replacing the board with a remote version has to wait: dropping the line
     *  under a moving pen is the most annoying possible way for sync to
     *  announce itself. */
    isDrawing: () => drafting != null || action != null || editing != null || gesture != null,

    /** Replace everything, without reporting any of it back — this is how a
     *  drawing arrives from the log or from another device. Boards drawn by
     *  older versions are converted on the way in. */
    restore(saved) {
      if (!Array.isArray(saved)) return;
      commitEditor();
      elements = migrateBoard(saved);
      selectedId = null;
      redraw();
    },

    /** Add, update or remove one element from elsewhere, leaving the rest and
     *  the undo history alone. */
    applyRemote(el) {
      const next = migrateElement(el);
      if (!next || !next.id) return;
      const i = elements.findIndex((e) => e.id === next.id);
      if (i >= 0) elements[i] = next; else elements.push(next);
      redraw();
    },
    removeRemote(id) {
      elements = elements.filter((e) => e.id !== id);
      if (selectedId === id) selectedId = null;
      redraw();
    },

    isEmpty: () => elements.length === 0,
    resize,
    zoomToFit,

    /**
     * A picture of the whole drawing, not of the current view.
     *
     * It is saved as a record of what was drawn, and a board that had been
     * panned away from its own contents used to save a blank rectangle. The
     * view is moved to frame everything, captured, and put back within the one
     * call, so nothing is painted in between and nothing flickers.
     */
    toDataUrl() {
      const wasView = view;
      const wasSelected = selectedId;
      selectedId = null;
      zoomToFit();
      redraw();
      const url = canvas.toDataURL("image/png");
      view = wasView;
      selectedId = wasSelected;
      showZoom();
      redraw();
      return url;
    },

    destroy() {
      commitEditor();
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerup", onWindowPointerEnd);
      window.removeEventListener("pointercancel", onWindowPointerEnd);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("wheel", onWheel);
    },
  };
}
