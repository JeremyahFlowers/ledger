// Module-lifecycle tests for js/pattern-model.js — load failures, memoization,
// and the explanation case that needs a differently-weighted model.
//
// Uses loadPatternModel({ refresh: true }) rather than cache-busted imports,
// for the same reason as the catalog tests: V8 merges coverage by file path, so
// re-importing the module reported 95%-covered code as 44%.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { loadPatternModel, analyze, explain, PatternModelError } from "../js/pattern-model.js";

function makeModel(over = {}) {
  return {
    version: 1,
    vocab: ["w:contiguous", "w:subarray", "w:tree", "c:size:le20"],
    idf: [2, 2, 2, 2],
    patterns: {
      "sliding-window": {
        indices: [0, 1], weights: [3, 2], intercept: -1,
        threshold: 0.5, auc: 0.9, precision: 0.8, recall: 0.7, positives: 100,
      },
      trees: {
        indices: [2], weights: [4], intercept: -2,
        threshold: 0.5, auc: 0.95, precision: 0.9, recall: 0.8, positives: 200,
      },
    },
    unavailable: { knapsack: { status: "insufficient-data", positives: 2 } },
    ...over,
  };
}

function serve(model) {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => model });
}

describe("loadPatternModel", () => {
  test("test_loadPatternModel_httpError_throwsTypedErrorWithStatus", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await assert.rejects(loadPatternModel({ refresh: true }),
      (e) => e instanceof PatternModelError && e.status === 503);
  });

  test("test_loadPatternModel_errorMessage_isSafeToShowAUser", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await assert.rejects(loadPatternModel({ refresh: true }), (e) => {
      assert.ok(!/HTTP|fetch|undefined|\[object/.test(e.message), `leaky message: ${e.message}`);
      return true;
    });
  });

  test("test_loadPatternModel_failureThenSuccess_retriesRatherThanCachingTheError", async () => {
    globalThis.fetch = async () => { throw new TypeError("offline"); };
    await assert.rejects(loadPatternModel({ refresh: true }));
    serve(makeModel());
    assert.ok((await loadPatternModel()).patterns.size > 0);
  });

  test("test_loadPatternModel_repeatedCalls_fetchOnlyOnce", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => makeModel() }; };
    await loadPatternModel({ refresh: true });
    await loadPatternModel();
    assert.equal(calls, 1, "a ~550 KB model must not be refetched per analysis");
  });

  test("test_loadPatternModel_refresh_picksUpARetrainedModel", async () => {
    serve(makeModel());
    await loadPatternModel({ refresh: true });
    serve(makeModel({ patterns: { greedy: { indices: [2], weights: [1], intercept: 0,
      threshold: 0.5, auc: 0.8, precision: 0.7, recall: 0.7, positives: 50 } } }));
    const after = await loadPatternModel({ refresh: true });
    assert.ok(after.patterns.has("greedy"), "a session left open should be able to pick up a retrain");
  });
});

describe("explain — counterfactual with overwhelming evidence", () => {
  test("test_counterfactual_evidenceSpreadThin_reportsNoFlipHonestly", async () => {
    // Overwhelming evidence should say "this doesn't rest on one phrase"
    // rather than inventing a flip that never happens.
    serve(makeModel({
      patterns: {
        trees: { indices: [2], weights: [50], intercept: 20, threshold: 0.5,
          auc: 0.9, precision: 0.9, recall: 0.9, positives: 10 },
      },
    }));
    await loadPatternModel({ refresh: true });
    const ex = explain(await analyze("tree tree tree"), "trees");
    assert.equal(ex.counterfactual.flipped, false);
    assert.equal(ex.counterfactual.becomes, null);
  });
});
