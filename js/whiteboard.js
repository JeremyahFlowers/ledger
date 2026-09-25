// The drawing surface.
//
// Pointer events throughout, so a trackpad, a finger and an Apple Pencil take
// the same code path and behave the same. What is on the board lives in
// board.js as plain data in logical coordinates; this file is the canvas and
// the tools.
//
// Everything is kept as elements rather than pixels, which is what lets undo
// replay rather than snapshot, lets a drawing move between devices at the right
// size, and lets a stroke be selected and moved after it is drawn.
//
// The tools are chosen for what a coding interview needs drawn, not for what a
// drawing app usually has. An array with index labels is one click, because it
// is the single most-drawn thing in an interview and the most tedious to
// produce freehand while someone watches. There is no fill, no layers, no
// gradients: none of them appear on a whiteboard in front of an interviewer.

import {
  BOARD_WIDTH, ELEMENT_KINDS, makeElement, toBoard, elementBounds, elementAt,
  movedBy, snapToAngle, cellLines, cellLabels, createHistory,
} from "./board.js";

const COLORS = ["#e7efeb", "#4fc3b8", "#e0a257", "#e2827c", "#7ed9cf"];

/** Tool, keyboard shortcut, and what it makes. The letters follow the
 *  convention every drawing tool shares, so they are already known. */
const TOOLS = [
  { key: "v", id: "select", label: "Select", glyph: "↖" },
  { key: "p", id: "pen", label: "Pen", glyph: "✎" },
  { key: "a", id: "arrow", label: "Arrow", glyph: "→" },
  { key: "l", id: "line", label: "Line", glyph: "╱" },
  { key: "r", id: "rect", label: "Box", glyph: "▭" },
  { key: "o", id: "ellipse", label: "Circle", glyph: "◯" },
  { key: "t", id: "text", label: "Text", glyph: "T" },
  { key: "g", id: "cells", label: "Array", glyph: "▦" },
];

/** Arrows are straightened by default. The reason to reach for an arrow tool
 *  rather than freehand is that it comes out straight; a wobbly one between two
 *  boxes reads as a mistake rather than as a pointer. */
const SNAP_BY_DEFAULT = new Set(["arrow", "line"]);

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
  root.innerHTML = `
    ${readOnly ? "" : `<div class="whiteboard-toolbar">
      <div class="wb-tools" role="toolbar" aria-label="Drawing tools">
        ${TOOLS.map((t) => `<button type="button" class="wb-tool" data-tool="${t.id}"
          title="${t.label} (${t.key.toUpperCase()})" aria-label="${t.label}"
          aria-pressed="${t.id === "pen"}">${t.glyph}</button>`).join("")}
      </div>
      <div class="wb-colors">
        ${COLORS.map((c, i) => `<button type="button" class="wb-color ${i === 0 ? "active" : ""}" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join("")}
      </div>
      <label class="wb-width-label">Width
        <input type="range" id="wb-width" min="1" max="12" value="3" />
      </label>
      <button type="button" class="btn btn-ghost btn-sm" id="wb-undo" title="Undo (Cmd/Ctrl-Z)">Undo</button>
      <button type="button" class="btn btn-ghost btn-sm" id="wb-redo" title="Redo (Cmd/Ctrl-Shift-Z)">Redo</button>
      <button type="button" class="btn btn-ghost btn-sm" id="wb-clear">Clear</button>
    </div>`}
    <canvas class="whiteboard-canvas" id="wb-canvas" ${readOnly ? "" : 'tabindex="0"'}></canvas>
  `;

  // Told what changed. The board knows nothing about sessions, sync or events:
  // it reports what happened and the caller decides where that goes.
  const { onAdd = null, onUpdate = null, onRemove = null, onClear = null } = hooks;

  const canvas = root.querySelector("#wb-canvas");
  const ctx = canvas.getContext("2d");

  let elements = [];
  let tool = "pen";
  let color = COLORS[0];
  let width = 3;
  let drafting = null;        // the element being drawn right now
  let selectedId = null;
  let dragging = null;        // { id, from, origin }
  let localSeq = 0;
  // A stack of reversible steps rather than a stack of board states: a board is
  // unbounded and a step is two functions. Its mechanics live in board.js,
  // where they can be tested without a canvas — which is where its one real bug
  // hid until they were.
  const history = createHistory();

  const nextId = () => `e${localSeq++}-${Math.random().toString(36).slice(2, 8)}`;
  const paneWidth = () => canvas.getBoundingClientRect().width || 1;
  const scale = () => (canvas.width || 1) / BOARD_WIDTH;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    redraw();
  }

  /** A pointer event in board units. */
  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    return toBoard({ x: e.clientX - rect.left, y: e.clientY - rect.top }, rect.width);
  }

  // ---- drawing ----

  function redraw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = getComputedStyle(root).getPropertyValue("--surface-alt") || "#1c2723";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // One transform for everything, so every draw function below works in board
    // units and none of them has to know about pixels or device ratios.
    const k = scale();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    for (const el of elements) draw(el, el.id === selectedId);
    if (drafting) draw(drafting, false);
  }

  function stroke(el) {
    ctx.strokeStyle = el.color;
    ctx.lineWidth = el.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  function draw(el, isSelected) {
    const pts = el.points || [];
    if (!pts.length) return;
    stroke(el);

    switch (el.kind) {
      case "pen": {
        if (pts.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
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
        ctx.strokeRect(b.x, b.y, b.w, b.h);
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
        ctx.fillStyle = el.color;
        ctx.font = `${el.width * 6}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textBaseline = "alphabetic";
        ctx.fillText(el.text || "", pts[0].x, pts[0].y);
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
        ctx.globalAlpha = 0.65;
        ctx.font = `${el.width * 4}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textAlign = "center";
        for (const label of cellLabels(el)) ctx.fillText(String(label.index), label.x, label.y);
        ctx.globalAlpha = 1;
        ctx.textAlign = "start";
        break;
      }
    }

    if (isSelected) {
      const b = elementBounds(el);
      if (!b) return;
      ctx.save();
      ctx.strokeStyle = "#7ed9cf";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
      ctx.restore();
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

  // ---- changing what is on the board ----

  function step(entry) { history.record(entry); }

  function add(el) {
    elements.push(el);
    step({ undo: () => removeById(el.id), redo: () => add(el) });
    redraw();
    if (onAdd) onAdd(el);
  }

  function removeById(id) {
    const i = elements.findIndex((e) => e.id === id);
    if (i < 0) return;
    const [gone] = elements.splice(i, 1);
    if (selectedId === id) selectedId = null;
    step({ undo: () => add(gone), redo: () => removeById(id) });
    redraw();
    if (onRemove) onRemove(id);
  }

  function replace(el) {
    const i = elements.findIndex((e) => e.id === el.id);
    if (i < 0) return;
    const before = elements[i];
    elements[i] = el;
    step({ undo: () => replace(before), redo: () => replace(el) });
    redraw();
    if (onUpdate) onUpdate(el);
  }

  const undo = () => { history.undo(); redraw(); };
  const redo = () => { history.redo(); redraw(); };

  // ---- input ----

  canvas.style.touchAction = "none";

  if (!readOnly) canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    canvas.focus?.();
    const at = pointFromEvent(e);

    if (tool === "select") {
      const hit = elementAt(elements, at);
      selectedId = hit ? hit.id : null;
      dragging = hit ? { id: hit.id, from: at, origin: hit } : null;
      redraw();
      return;
    }

    if (tool === "text") {
      // Asked for rather than typed onto the canvas: a text cursor that only
      // some of the board has is a mode people get lost in, and an interview is
      // not the moment to discover one.
      const value = prompt("Label");
      if (value) add(makeElement("text", { id: nextId(), color, width, points: [at], text: value }));
      return;
    }

    drafting = makeElement(tool, {
      id: nextId(), color, width,
      points: tool === "pen" ? [at] : [at, at],
      ...(tool === "cells" ? { cols: 8, rows: 1 } : {}),
    });
    redraw();
  });

  if (!readOnly) canvas.addEventListener("pointermove", (e) => {
    const at = pointFromEvent(e);

    if (dragging) {
      const el = elements.find((x) => x.id === dragging.id);
      if (!el) return;
      const moved = movedBy(dragging.origin, at.x - dragging.from.x, at.y - dragging.from.y);
      elements[elements.indexOf(el)] = moved;
      redraw();
      return;
    }

    if (!drafting) return;
    if (drafting.kind === "pen") drafting.points.push(at);
    else {
      const snap = e.shiftKey || SNAP_BY_DEFAULT.has(drafting.kind);
      drafting.points[1] = snap ? snapToAngle(drafting.points[0], at) : at;
    }
    redraw();
  });

  const finish = () => {
    if (dragging) {
      const el = elements.find((x) => x.id === dragging.id);
      const from = dragging.origin;
      dragging = null;
      // Reported once, at the end, rather than for every pixel of the drag.
      if (el && (el.points[0].x !== from.points[0].x || el.points[0].y !== from.points[0].y)) {
        elements[elements.indexOf(el)] = from;   // put it back so replace() can record the step
        replace(el);
      }
      return;
    }
    if (!drafting) return;
    const el = drafting;
    drafting = null;
    // A tap with no drag is not a shape. Pen keeps single points, because a dot
    // is a legitimate mark.
    const b = elementBounds(el);
    const tiny = b && b.w < 2 && b.h < 2;
    if (el.kind !== "pen" && tiny) { redraw(); return; }
    if (el.kind === "pen" && el.points.length < 2) { redraw(); return; }
    add(el);
  };
  if (!readOnly) {
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
  }

  // ---- keyboard ----

  const onKey = (e) => {
    if (e.target !== canvas) return;
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && selectedId) {
      e.preventDefault();
      removeById(selectedId);
      return;
    }
    if (e.key === "Escape") { selectedId = null; redraw(); return; }
    const match = TOOLS.find((t) => t.key === e.key.toLowerCase());
    if (match && !meta) { e.preventDefault(); setTool(match.id); }
  };
  if (!readOnly) canvas.addEventListener("keydown", onKey);

  // ---- toolbar ----

  function setTool(id) {
    tool = id;
    if (id !== "select") selectedId = null;
    root.querySelectorAll(".wb-tool").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.tool === id)));
    canvas.style.cursor = id === "select" ? "default" : "crosshair";
    redraw();
  }

  root.querySelectorAll(".wb-tool").forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  });
  // Everything below binds to toolbar controls, which a read-only board has
  // none of. querySelector returns null there, so each has to be guarded — or
  // this can simply stop.
  root.querySelectorAll(".wb-color").forEach((btn) => {
    btn.addEventListener("click", () => {
      color = btn.dataset.color;
      root.querySelectorAll(".wb-color").forEach((b) => b.classList.toggle("active", b === btn));
      // Recolours the selection, which is what clicking a colour with something
      // selected obviously means.
      const sel = elements.find((e) => e.id === selectedId);
      if (sel) replace({ ...sel, color });
    });
  });
  root.querySelector("#wb-width")?.addEventListener("input", (e) => { width = Number(e.target.value); });
  root.querySelector("#wb-undo")?.addEventListener("click", undo);
  root.querySelector("#wb-redo")?.addEventListener("click", redo);
  root.querySelector("#wb-clear")?.addEventListener("click", () => {
    if (!elements.length) return;
    const previous = elements;
    elements = [];
    selectedId = null;
    // Undoing a clear puts the whole board back at once, and the caller is told
    // both ways — a clear on one device that could not be undone on the other
    // would leave the two permanently different.
    step({
      undo: () => { elements = previous; redraw(); previous.forEach((el) => onAdd?.(el)); },
      redo: () => { elements = []; redraw(); onClear?.(); },
    });
    redraw();
    if (onClear) onClear();
  });

  window.addEventListener("resize", resize);
  resize();

  return {
    toJSON: () => elements.map((el) => ({ ...el, points: el.points.map((p) => ({ ...p })) })),

    /** True while something is being drawn or dragged. A caller replacing the
     *  board with a remote version has to wait: dropping the line under a
     *  moving pen is the most annoying possible way for sync to announce
     *  itself. */
    isDrawing: () => drafting != null || dragging != null,

    /** Replace everything, without reporting any of it back — this is how a
     *  drawing arrives from the log or from another device. */
    restore(saved) {
      if (!Array.isArray(saved)) return;
      elements = saved.filter((el) => el && Array.isArray(el.points));
      selectedId = null;
      redraw();
    },

    /** Add, update or remove one element from elsewhere, leaving the rest and
     *  the undo history alone. */
    applyRemote(el) {
      if (!el || !el.id) return;
      const i = elements.findIndex((e) => e.id === el.id);
      if (i >= 0) elements[i] = el; else elements.push(el);
      redraw();
    },
    removeRemote(id) {
      elements = elements.filter((e) => e.id !== id);
      if (selectedId === id) selectedId = null;
      redraw();
    },

    isEmpty: () => elements.length === 0,
    resize,
    toDataUrl: () => canvas.toDataURL("image/png"),
    destroy() {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("keydown", onKey);
    },
  };
}
