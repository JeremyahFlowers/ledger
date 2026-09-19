// Structural validation for the worked examples in js/diagram-data.js.
//
// These are hand-authored traces, and the failure mode is quiet: a grid step
// referencing a row that doesn't exist, or a graph step naming a node that was
// never declared, renders as a diagram that simply omits something. It still
// animates, still looks finished, and teaches the wrong thing. Nothing else
// checks them, because the data is only ever read by a renderer that shrugs at
// anything it can't find.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { DIAGRAM_SPECS } from "../js/diagram-data.js";
import { PATTERNS } from "../js/seed.js";

const ALL = Object.entries(DIAGRAM_SPECS).flatMap(([pattern, specs]) =>
  specs.map((spec, i) => ({ pattern, i, spec, where: `${pattern}[${i}] "${spec.title}"` })));

describe("diagram coverage", () => {
  test("test_diagrams_everyPatternHasAtLeastOne", () => {
    for (const p of PATTERNS) {
      assert.ok(DIAGRAM_SPECS[p.id]?.length, `${p.name} has no worked example`);
    }
  });

  test("test_diagrams_onlyReferenceRealPatterns", () => {
    const ids = new Set(PATTERNS.map((p) => p.id));
    for (const key of Object.keys(DIAGRAM_SPECS)) {
      assert.ok(ids.has(key), `"${key}" has diagrams but is not a pattern`);
    }
  });
});

describe("diagram structure", () => {
  test("test_diagrams_eachDeclaresAKnownPrimitive", () => {
    for (const { spec, where } of ALL) {
      assert.ok(["array", "stack", "grid", "graph"].includes(spec.kind), `${where}: kind "${spec.kind}"`);
    }
  });

  test("test_diagrams_eachHasATitleAndSteps", () => {
    for (const { spec, where } of ALL) {
      assert.ok(spec.title?.length > 5, `${where}: title too short`);
      assert.ok(spec.steps?.length >= 2, `${where}: needs at least two frames to be an animation`);
    }
  });

  test("test_diagrams_everyStepExplainsItself", () => {
    // A frame without a caption is a picture changing for no stated reason.
    // The floor is low because some frames are deliberate state echoes between
    // two action frames ("Stack: [5].") and reading fine as such.
    for (const { spec, where } of ALL) {
      spec.steps.forEach((step, i) => {
        assert.ok(step.caption?.trim().length > 8, `${where} step ${i}: caption missing or too terse`);
      });
    }
  });

  test("test_diagrams_captionsReadAsFinishedText", () => {
    // Sentence punctuation, or a closing delimiter for the captions that end
    // in a literal — forcing a full stop after `map = { aet: [eat] }` would
    // read worse, not better.
    for (const { spec, where } of ALL) {
      spec.steps.forEach((step, i) => {
        assert.ok(/[.!?}\]")]$/.test(step.caption.trim()),
          `${where} step ${i}: caption ends mid-thought — ${JSON.stringify(step.caption.slice(-24))}`);
      });
    }
  });
});

describe("array and stack references", () => {
  test("test_arrayDiagrams_indicesStayInBounds", () => {
    for (const { spec, where } of ALL.filter((d) => d.spec.kind === "array")) {
      const n = spec.array.length;
      spec.steps.forEach((step, i) => {
        for (const idx of [...(step.highlight || []), ...(step.dim || [])]) {
          assert.ok(idx >= 0 && idx < n, `${where} step ${i}: index ${idx} outside array of ${n}`);
        }
        for (const [name, idx] of Object.entries(step.pointers || {})) {
          assert.ok(idx >= -1 && idx <= n, `${where} step ${i}: pointer ${name} at ${idx}, array is ${n}`);
        }
      });
    }
  });

  test("test_stackDiagrams_cursorAndConsumedStayInBounds", () => {
    for (const { spec, where } of ALL.filter((d) => d.spec.kind === "stack")) {
      const n = spec.array.length;
      spec.steps.forEach((step, i) => {
        if (step.cursor != null) {
          assert.ok(step.cursor >= 0 && step.cursor < n, `${where} step ${i}: cursor ${step.cursor} outside ${n}`);
        }
        for (const idx of step.consumed || []) {
          assert.ok(idx >= 0 && idx < n, `${where} step ${i}: consumed ${idx} outside ${n}`);
        }
      });
    }
  });
});

describe("grid references", () => {
  test("test_gridDiagrams_coordinatesStayInsideTheGrid", () => {
    for (const { spec, where } of ALL.filter((d) => d.spec.kind === "grid")) {
      const check = (cells, label, i) => {
        for (const [r, c] of cells || []) {
          assert.ok(r >= 0 && r < spec.rows, `${where} step ${i}: ${label} row ${r} outside ${spec.rows}`);
          assert.ok(c >= 0 && c < spec.cols, `${where} step ${i}: ${label} col ${c} outside ${spec.cols}`);
        }
      };
      spec.steps.forEach((step, i) => {
        check(step.highlight, "highlight", i);
        check(step.active, "active", i);
        if (step.values) {
          assert.ok(step.values.length <= spec.rows, `${where} step ${i}: ${step.values.length} value rows, grid has ${spec.rows}`);
          step.values.forEach((row, r) => {
            assert.ok(row.length <= spec.cols, `${where} step ${i}: value row ${r} has ${row.length} cells, grid has ${spec.cols}`);
          });
        }
      });
    }
  });

  test("test_gridDiagrams_columnLabelsMatchTheColumnCount", () => {
    for (const { spec, where } of ALL.filter((d) => d.spec.kind === "grid")) {
      if (!spec.cellLabels?.cols) continue;
      assert.equal(spec.cellLabels.cols.length, spec.cols, `${where}: label count doesn't match columns`);
    }
  });
});

describe("graph references", () => {
  test("test_graphDiagrams_everyEdgeConnectsDeclaredNodes", () => {
    for (const { spec, where } of ALL.filter((d) => d.spec.kind === "graph")) {
      const ids = new Set(spec.nodes.map((n) => n.id));
      for (const e of spec.edges) {
        assert.ok(ids.has(e.from), `${where}: edge from unknown node "${e.from}"`);
        assert.ok(ids.has(e.to), `${where}: edge to unknown node "${e.to}"`);
      }
    }
  });

  test("test_graphDiagrams_stepsOnlyNameDeclaredNodes", () => {
    for (const { spec, where } of ALL.filter((d) => d.spec.kind === "graph")) {
      const ids = new Set(spec.nodes.map((n) => n.id));
      spec.steps.forEach((step, i) => {
        for (const id of [...(step.activeNodes || []), ...(step.doneNodes || [])]) {
          assert.ok(ids.has(id), `${where} step ${i}: names unknown node "${id}"`);
        }
      });
    }
  });

  test("test_graphDiagrams_stepsOnlyNameDeclaredEdges", () => {
    // The renderer looks edges up by "from-to" and silently ignores a miss, so
    // a typo here just means a highlight that never appears.
    for (const { spec, where } of ALL.filter((d) => d.spec.kind === "graph")) {
      const keys = new Set(spec.edges.flatMap((e) => [`${e.from}-${e.to}`, `${e.to}-${e.from}`]));
      spec.steps.forEach((step, i) => {
        for (const [a, b] of [...(step.activeEdges || []), ...(step.doneEdges || [])]) {
          assert.ok(keys.has(`${a}-${b}`), `${where} step ${i}: names edge ${a}-${b}, which doesn't exist`);
        }
      });
    }
  });

  test("test_graphDiagrams_nodesFitInsideTheViewBox", () => {
    // Width is fixed at 320 in diagrams.js and nodes have radius 15.
    for (const { spec, where } of ALL.filter((d) => d.spec.kind === "graph")) {
      const height = spec.height ?? 180;
      for (const n of spec.nodes) {
        assert.ok(n.x >= 15 && n.x <= 305, `${where}: node ${n.id} at x=${n.x} is clipped`);
        assert.ok(n.y >= 15 && n.y <= height - 15, `${where}: node ${n.id} at y=${n.y} is clipped (height ${height})`);
      }
    }
  });
});
