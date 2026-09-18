// Tests for js/pattern-model.js.
//
// The Analyze view makes a strong claim to the user: the highlighted phrases
// are the actual reason for a prediction, not an illustration of it. That claim
// is only true if contribution really equals weight x value and the parts
// really sum to the whole. Those invariants are what this file pins — if they
// break, the feature is lying rather than merely inaccurate.
//
// A hand-built model is used instead of the trained artifact so the arithmetic
// is checkable by eye and the tests don't shift every time the model is
// retrained.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

/** Two patterns with known weights over a tiny vocabulary. */
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

// The module memoizes its artifact, so the common case is exercised through a
// single real import: stub fetch once, load once, reuse. Only the tests that
// are specifically about load failure need a pristine module instance, and they
// say so. Cache-busting every import would test a different module object each
// time and report the real file as uncovered.
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => makeModel() });
const { analyze, explain, readableFeature } = await import("../js/pattern-model.js");

const SLIDING_TEXT = "contiguous subarray contiguous";
const TREE_TEXT = "tree tree tree";

describe("analyze", () => {
  test("test_analyze_ranksPatternsByProbabilityDescending", async () => {
    const { predictions } = await analyze(SLIDING_TEXT);
    for (let i = 1; i < predictions.length; i++) {
      assert.ok(predictions[i - 1].probability >= predictions[i].probability);
    }
    assert.equal(predictions[0].pattern, "sliding-window");
  });

  test("test_analyze_probabilitiesAreValid", async () => {
    for (const p of (await analyze(SLIDING_TEXT)).predictions) {
      assert.ok(p.probability >= 0 && p.probability <= 1, `bad probability ${p.probability}`);
    }
  });

  test("test_analyze_nothingClearsThreshold_reportsNoneApply", async () => {
    // The honest answer for a problem outside the taxonomy.
    const res = await analyze("completely unrelated prose about gardening");
    assert.equal(res.noneApply, true);
    assert.deepEqual(res.matched, []);
  });

  test("test_analyze_strongEvidence_marksPatternConfident", async () => {
    const res = await analyze(TREE_TEXT);
    assert.equal(res.noneApply, false);
    assert.ok(res.matched.some((m) => m.pattern === "trees"));
  });

  test("test_analyze_outOfVocabularyWords_areIgnoredNotGuessed", async () => {
    const known = await analyze("tree");
    const withNoise = await analyze("tree zzzzzz qqqqqq");
    const a = known.predictions.find((p) => p.pattern === "trees").probability;
    const b = withNoise.predictions.find((p) => p.pattern === "trees").probability;
    assert.equal(a.toFixed(10), b.toFixed(10), "unknown words must not move a prediction");
  });

  test("test_analyze_reportsCoverageIncludingUnpredictablePatterns", async () => {
    const res = await analyze(TREE_TEXT);
    assert.equal(res.coverage.predictable, 2);
    assert.equal(res.coverage.total, 3);
    assert.ok("knapsack" in res.unavailable);
  });

  test("test_analyze_carriesPerPatternReliability", async () => {
    // Shown next to every prediction so the user can calibrate trust.
    const trees = (await analyze(TREE_TEXT)).predictions.find((p) => p.pattern === "trees");
    assert.equal(trees.reliability.auc, 0.95);
    assert.equal(trees.reliability.trainedOn, 200);
  });

  test("test_analyze_emptyInput_doesNotThrow", async () => {
    await assert.doesNotReject(() => analyze(""));
  });
});

describe("explain — faithfulness", () => {
  test("test_explain_contributionEqualsWeightTimesValue", async () => {
    // The literal claim the UI makes about its highlights.
    const res = await analyze(SLIDING_TEXT);
    const ex = explain(res, "sliding-window");
    for (const c of [...ex.supporting, ...ex.opposing]) {
      assert.ok(Math.abs(c.contribution - c.weight * c.value) < 1e-12,
        `${c.feature}: ${c.contribution} != ${c.weight} * ${c.value}`);
    }
  });

  test("test_explain_contributionsPlusInterceptReproduceTheScore", async () => {
    // If the parts don't sum to the whole, the explanation is hiding something.
    const res = await analyze(SLIDING_TEXT);
    const ex = explain(res, "sliding-window", { top: Infinity });
    const summed = ex.supporting.concat(ex.opposing)
      .reduce((total, c) => total + c.contribution, ex.intercept);
    const score = res.predictions.find((p) => p.pattern === "sliding-window").score;
    assert.ok(Math.abs(summed - score) < 1e-9, `parts ${summed} != whole ${score}`);
  });

  test("test_explain_regionTotalsAccountForEveryContribution", async () => {
    const res = await analyze(SLIDING_TEXT);
    const ex = explain(res, "sliding-window", { top: Infinity });
    const byRegion = Object.values(ex.byRegion).reduce((a, b) => a + b, 0);
    const total = ex.supporting.concat(ex.opposing).reduce((a, c) => a + c.contribution, 0);
    assert.ok(Math.abs(byRegion - total) < 1e-9,
      "a phrase's contribution must be fully attributed across the regions it appears in");
  });

  test("test_explain_supportingSortedByContributionDescending", async () => {
    const ex = explain(await analyze(SLIDING_TEXT), "sliding-window");
    for (let i = 1; i < ex.supporting.length; i++) {
      assert.ok(ex.supporting[i - 1].contribution >= ex.supporting[i].contribution);
    }
  });

  test("test_explain_supportingAndOpposing_haveCorrectSigns", async () => {
    const ex = explain(await analyze(SLIDING_TEXT), "sliding-window");
    assert.ok(ex.supporting.every((c) => c.contribution > 0));
    assert.ok(ex.opposing.every((c) => c.contribution < 0));
  });

  test("test_explain_spansPointAtRealText", async () => {
    const res = await analyze(SLIDING_TEXT);
    const ex = explain(res, "sliding-window");
    assert.ok(ex.spanWeights.length > 0);
    for (const s of ex.spanWeights) {
      assert.ok(s.start >= 0 && s.end <= res.text.length && s.start < s.end);
    }
  });

  test("test_explain_unknownPattern_returnsNull", async () => {
    assert.equal(explain(await analyze(SLIDING_TEXT), "not-a-pattern"), null);
  });

  test("test_explain_constraintFeatures_surfacedRegardlessOfRank", async () => {
    // These rarely crack the top dozen by weight, but the sizing argument is
    // exactly what an interview wants, so they get their own channel.
    const res = await analyze("tree\n\nConstraints:\n1 <= n <= 20\n");
    const ex = explain(res, "trees");
    assert.ok(Array.isArray(ex.constraints));
  });
});

describe("explain — counterfactual", () => {
  test("test_counterfactual_removingTopEvidence_flipsThePrediction", async () => {
    const ex = explain(await analyze(SLIDING_TEXT), "sliding-window");
    assert.equal(ex.counterfactual.flipped, true);
    assert.ok(ex.counterfactual.removed.length > 0);
  });

  test("test_counterfactual_namesWhatThePredictionBecomes", async () => {
    const ex = explain(await analyze(SLIDING_TEXT), "sliding-window");
    assert.ok(ex.counterfactual.becomes, "a flip should say what it flips to");
    assert.notEqual(ex.counterfactual.becomes.pattern, "sliding-window");
  });

});

describe("readableFeature", () => {
  test("test_readableFeature_ngram_dropsInternalPrefix", async () => {
    assert.equal(readableFeature("w:contiguous subarray"), "contiguous subarray");
  });

  test("test_readableFeature_constraintFeature_readsAsPlainLanguage", async () => {
    assert.equal(readableFeature("c:size:le20"), "input size up to 20");
    assert.equal(readableFeature("c:none"), "no stated constraints");
    assert.equal(readableFeature("c:has_negative"), "values can be negative");
  });
});

