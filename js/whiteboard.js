// A pointer-events-based drawing surface — mouse, touch, and stylus all use
// the same code path, so it works the same on a laptop trackpad and an iPad
// with a pencil. Strokes are kept as data (not just pixels) so undo can
// replay everything except the last stroke instead of needing a pixel-level
// undo stack.
const COLORS = ["#e7efeb", "#4fc3b8", "#e0a257", "#e2827c", "#7ed9cf"];

export function createWhiteboard(root, hooks = {}) {
  root.innerHTML = `
    <div class="whiteboard-toolbar">
      <div class="wb-colors">
        ${COLORS.map((c, i) => `<button type="button" class="wb-color ${i === 0 ? "active" : ""}" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join("")}
      </div>
      <label class="wb-width-label">Width
        <input type="range" id="wb-width" min="1" max="12" value="3" />
      </label>
      <button type="button" class="btn btn-ghost btn-sm" id="wb-undo">Undo</button>
      <button type="button" class="btn btn-ghost btn-sm" id="wb-clear">Clear</button>
    </div>
    <canvas class="whiteboard-canvas" id="wb-canvas"></canvas>
  `;

  // Told about completed strokes, undos and clears. The board still knows
  // nothing about sessions, sync or events — it reports what was drawn and the
  // caller decides whether that is worth sending anywhere.
  const { onStroke = null, onUndo = null, onClear = null } = hooks;

  const canvas = root.querySelector("#wb-canvas");
  const ctx = canvas.getContext("2d");
  const strokes = [];
  let current = null;
  let localSeq = 0;
  let color = COLORS[0];
  let width = 3;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    redraw();
  }

  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
  }

  function redraw() {
    ctx.fillStyle = getComputedStyle(root).getPropertyValue("--surface-alt") || "#1c2723";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) drawStroke(s);
  }

  function drawStroke(s) {
    if (s.points.length < 2) return;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width * (window.devicePixelRatio || 1);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
    ctx.stroke();
  }

  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    // Identified at birth. A stroke needs a name before anything can undo it or
    // recognise it arriving back from another device, and the board is the only
    // thing that knows when one began.
    current = { id: `s${localSeq++}-${Math.random().toString(36).slice(2, 8)}`, color, width, points: [pointFromEvent(e)] };
    strokes.push(current);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!current) return;
    current.points.push(pointFromEvent(e));
    redraw();
  });
  const endStroke = () => {
    // Reported on completion rather than per point: a stroke is the unit a
    // person draws and the unit worth sending.
    if (current && current.points.length && onStroke) onStroke({ ...current, points: current.points.slice() });
    current = null;
  };
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);

  root.querySelectorAll(".wb-color").forEach((btn) => {
    btn.addEventListener("click", () => {
      color = btn.dataset.color;
      root.querySelectorAll(".wb-color").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });
  root.querySelector("#wb-width").addEventListener("input", (e) => {
    width = Number(e.target.value);
  });
  root.querySelector("#wb-undo").addEventListener("click", () => {
    const removed = strokes.pop();
    redraw();
    if (removed && onUndo) onUndo(removed.id);
  });
  root.querySelector("#wb-clear").addEventListener("click", () => {
    strokes.length = 0;
    redraw();
    if (onClear) onClear();
  });

  window.addEventListener("resize", resize);
  resize();

  return {
    isEmpty: () => strokes.length === 0,
    toDataUrl: () => canvas.toDataURL("image/png"),
    // Exposed for the workspace, where dragging a pane splitter changes the
    // canvas's box without the window ever firing a resize. Safe to call at
    // any point: the board is stroke-backed, so resize() replays what was
    // drawn rather than scaling or clearing a bitmap.
    resize,

    /**
     * The drawing as plain data, for checkpointing a session.
     *
     * Strokes rather than pixels, which is what makes this cheap enough to
     * write on every change and what lets it be replayed onto a canvas of a
     * different size later. Copied on the way out so a caller holding the
     * result can't mutate the live board.
     */
    toJSON: () => strokes.map((s) => ({ id: s.id, color: s.color, width: s.width, points: s.points.slice() })),

    /** True while a stroke is being drawn. A caller replacing the board with a
     *  remote version has to wait: dropping the line under a moving pen is the
     *  most annoying possible way for sync to announce itself. */
    isDrawing: () => current != null,

    /** Replace the drawing with previously serialized strokes. */
    restore(saved) {
      if (!Array.isArray(saved)) return;
      strokes.length = 0;
      for (const s of saved) {
        // Defensive: this comes back from storage, which anything could have
        // written. A malformed stroke should be skipped, not thrown on.
        if (s && Array.isArray(s.points)) {
          strokes.push({ id: s.id, color: s.color, width: s.width, points: s.points });
        }
      }
      redraw();
    },
    destroy: () => window.removeEventListener("resize", resize),
  };
}
