// Tests for js/featurize.js.
//
// scripts/test_conformance.py already proves this file agrees with its Python
// twin. That catches drift but not shared wrongness — both could be wrong in
// the same way. These tests pin the behaviour itself, especially the two rules
// that were bugs first: constraint bounds must be bound to a variable rather
// than scraped from anywhere in the text, and subscripted names must tokenize
// identically whether they arrive as HTML or as a plain-text paste.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  toPlain, tokenize, ngramFeatures, constraintFeatures, featurize, regionAt, MAX_NGRAM,
} from "../js/featurize.js";

/** Region label for the first occurrence of a substring. */
function regionOf(text, regions, needle) {
  return regionAt(regions, text.indexOf(needle));
}

function featureNames(raw) {
  return [...featurize(raw).features.keys()];
}

function constraintNames(raw) {
  return featureNames(raw).filter((f) => f.startsWith("c:"));
}

describe("toPlain", () => {
  test("test_toPlain_htmlTags_areStripped", () => {
    const { text } = toPlain("<p>Given an <code>array</code>.</p>");
    assert.ok(!text.includes("<"), "markup must not survive into displayed text");
    assert.ok(text.includes("array"));
  });

  test("test_toPlain_htmlEntities_areDecoded", () => {
    const { text } = toPlain("<p>a &lt; b &amp;&amp; c &gt; d &quot;ok&quot;</p>");
    assert.ok(text.includes("a < b && c > d"));
    assert.ok(text.includes('"ok"'));
  });

  test("test_toPlain_numericEntities_areDecoded", () => {
    const { text } = toPlain("<p>it&#39;s fine</p>");
    assert.ok(text.includes("it's fine"));
  });

  test("test_toPlain_plainTextInput_passesThroughUnchanged", () => {
    const { text } = toPlain("No markup at all here.");
    assert.equal(text, "No markup at all here.");
  });

  test("test_toPlain_emptyInput_returnsEmptyTextAndNoRegions", () => {
    const { text, regions } = toPlain("");
    assert.equal(text, "");
    assert.deepEqual(regions, []);
  });
});

describe("region segmentation", () => {
  const LEETCODE_HTML =
    "<p>Find the longest substring.</p>" +
    "<pre><strong>Input:</strong> s = &quot;abc&quot;\n<strong>Output:</strong> 3</pre>" +
    "<p><strong>Constraints:</strong></p><ul><li><code>1 &lt;= s.length &lt;= 10^5</code></li></ul>";

  const PLAIN_PASTE =
    "Merge overlapping ranges.\n\n" +
    "Example 1:\nInput: ranges = [[1,4],[3,6]]\nOutput: [[1,6]]\n\n" +
    "Constraints:\n1 <= ranges.length <= 10^4\n";

  test("test_regions_leetcodeHtml_splitsStatementExampleConstraints", () => {
    const { text, regions } = toPlain(LEETCODE_HTML);
    assert.equal(regionOf(text, regions, "longest substring"), "statement");
    assert.equal(regionOf(text, regions, "abc"), "example");
    assert.equal(regionOf(text, regions, "s.length"), "constraints");
  });

  test("test_regions_plainTextPaste_splitsStatementExampleConstraints", () => {
    // Plain-text headings carry content on the same line, so the line-anchored
    // pattern never matched them and every pasted problem reported
    // "example: 0.00" in the evidence breakdown.
    const { text, regions } = toPlain(PLAIN_PASTE);
    assert.equal(regionOf(text, regions, "Merge overlapping"), "statement");
    assert.equal(regionOf(text, regions, "[[1,4]"), "example");
    assert.equal(regionOf(text, regions, "ranges.length"), "constraints");
  });

  test("test_regions_constraintsOverlappingExample_constraintsWin", () => {
    // The bounds are the single most informative part of a problem, so they
    // must never be swallowed by a surrounding example block.
    const { text, regions } = toPlain(LEETCODE_HTML);
    assert.equal(regionOf(text, regions, "10^5"), "constraints");
  });

  test("test_regions_noHeadingsAtAll_everythingIsStatement", () => {
    const { text, regions } = toPlain("Just one sentence.");
    assert.equal(regionAt(regions, 0), "statement");
    assert.equal(regions.length, 1);
  });

  test("test_regions_coverEveryCharacterContiguously", () => {
    const { text, regions } = toPlain(LEETCODE_HTML);
    assert.equal(regions[0][1], 0);
    assert.equal(regions.at(-1)[2], text.length);
    for (let i = 1; i < regions.length; i++) {
      assert.equal(regions[i][1], regions[i - 1][2], "region cover must not have gaps or overlaps");
    }
  });
});

describe("tokenize", () => {
  test("test_tokenize_subscriptSpellings_produceTheSameToken", () => {
    // start<sub>i</sub> arrives as "starti" from HTML and "start_i" from a
    // paste. Splitting on the underscore dropped the single letter and cost
    // the model its strongest intervals features.
    const fromHtml = tokenize(...Object.values(toPlain("starti endi"))).map((t) => t[0]);
    const fromPaste = tokenize(...Object.values(toPlain("start_i end_i"))).map((t) => t[0]);
    assert.deepEqual(fromPaste, fromHtml);
    assert.deepEqual(fromPaste, ["starti", "endi"]);
  });

  test("test_tokenize_stopwords_areDropped", () => {
    const { text, regions } = toPlain("the array of numbers");
    const toks = tokenize(text, regions).map((t) => t[0]);
    assert.ok(!toks.includes("the"));
    assert.ok(toks.includes("array"));
  });

  test("test_tokenize_singleLetters_areDropped", () => {
    const { text, regions } = toPlain("a b array");
    assert.deepEqual(tokenize(text, regions).map((t) => t[0]), ["array"]);
  });

  test("test_tokenize_integers_collapseToMagnitudeTokens", () => {
    // Otherwise every distinct literal claims its own vocabulary entry.
    const { text, regions } = toPlain("7 42 1000");
    assert.deepEqual(tokenize(text, regions).map((t) => t[0]), ["<num1>", "<num2>", "<num4>"]);
  });

  test("test_tokenize_recordsSpanOffsetsIntoDisplayText", () => {
    const { text, regions } = toPlain("find the subarray");
    const [tok, start, end] = tokenize(text, regions)[0];
    assert.equal(text.slice(start, end).toLowerCase(), tok);
  });
});

describe("ngramFeatures", () => {
  test("test_ngramFeatures_buildsUpToMaxNgram", () => {
    const { text, regions } = toPlain("longest contiguous subarray sum");
    const names = [...ngramFeatures(tokenize(text, regions)).keys()];
    assert.ok(names.includes("w:longest"));
    assert.ok(names.includes("w:longest contiguous"));
    assert.ok(names.includes("w:longest contiguous subarray"));
    const longest = Math.max(...names.map((n) => n.slice(2).split(" ").length));
    assert.equal(longest, MAX_NGRAM);
  });

  test("test_ngramFeatures_phraseNeverStraddlesARegionBoundary", () => {
    // A phrase half in the statement and half in the constraints describes
    // nothing real, and would misattribute evidence between regions.
    const raw = "find a window\n\nConstraints:\n1 <= n <= 10\n";
    const { text, regions } = toPlain(raw);
    for (const [, spans] of ngramFeatures(tokenize(text, regions))) {
      for (const [start, end] of spans) {
        assert.equal(regionAt(regions, start), regionAt(regions, end - 1));
      }
    }
  });

  test("test_ngramFeatures_repeatedPhrase_recordsEveryOccurrence", () => {
    const { text, regions } = toPlain("subarray and another subarray");
    const spans = ngramFeatures(tokenize(text, regions)).get("w:subarray");
    assert.equal(spans.length, 2);
  });
});

describe("constraint parsing", () => {
  test("test_constraints_sizeBound_bucketsByMagnitude", () => {
    assert.ok(constraintNames("x\n\nConstraints:\n1 <= n <= 20\n").includes("c:size:le20"));
    assert.ok(constraintNames("x\n\nConstraints:\n1 <= n <= 100000\n").includes("c:size:le1e5"));
    assert.ok(constraintNames("x\n\nConstraints:\n1 <= n <= 10^9\n").includes("c:size:gt1e6"));
  });

  test("test_constraints_exponentNotation_parsedLikeLiteral", () => {
    const withCaret = constraintNames("x\n\nConstraints:\n1 <= n <= 10^5\n");
    const withDigits = constraintNames("x\n\nConstraints:\n1 <= n <= 100000\n");
    assert.deepEqual(withCaret, withDigits);
  });

  test("test_constraints_elementValueBound_isNotReadAsInputSize", () => {
    const names = constraintNames("x\n\nConstraints:\n1 <= nums.length <= 10^5\n0 <= nums[i] <= 100\n");
    assert.ok(names.includes("c:size:le1e5"));
    assert.ok(names.includes("c:value:le100"));
  });

  test("test_constraints_innerArrayArity_doesNotMasqueradeAsTinyInput", () => {
    // "prerequisites[i].length == 2" once read as n <= 2, which implies
    // exponential work is affordable — badly wrong on a 2000-node graph.
    const names = constraintNames(
      "x\n\nConstraints:\n1 <= numCourses <= 2000\nprerequisites[i].length == 2\n");
    assert.ok(names.includes("c:size:le1e4"), `got ${names}`);
    assert.ok(!names.includes("c:size:le20"));
  });

  test("test_constraints_adjacentLines_doNotMergeIntoOneNumber", () => {
    // The number pattern once allowed whitespace, so "2000 \n 0 <= ..." parsed
    // as the single value 20000.
    const names = constraintNames("x\n\nConstraints:\n1 <= n <= 2000\n0 <= m <= 5\n");
    assert.ok(names.includes("c:size:le1e4"), `got ${names}`);
  });

  test("test_constraints_negativeLowerBound_isFlagged", () => {
    assert.ok(constraintNames("x\n\nConstraints:\n-10^9 <= nums[i] <= 10^9\n").includes("c:has_negative"));
  });

  test("test_constraints_boundsOutsideConstraintsRegion_areIgnored", () => {
    // Story numbers must never be read as input bounds.
    const names = constraintNames("Alice ran 40 laps and scored 100 points in 12 games.");
    assert.deepEqual(names, ["c:none"]);
  });

  test("test_constraints_absent_emitsExplicitNoneMarker", () => {
    assert.deepEqual(constraintNames("Just prose."), ["c:none"]);
  });
});

describe("featurize", () => {
  test("test_featurize_everySpanIndexesIntoReturnedText", () => {
    const raw = "<p>Find the longest substring.</p><p><strong>Constraints:</strong></p>"
      + "<ul><li><code>1 &lt;= n &lt;= 10^5</code></li></ul>";
    const { text, features } = featurize(raw);
    for (const [name, spans] of features) {
      for (const [start, end] of spans) {
        assert.ok(start >= 0 && end <= text.length, `${name} span ${start}-${end} escapes the text`);
      }
    }
  });

  test("test_featurize_emptyInput_doesNotThrow", () => {
    assert.doesNotThrow(() => featurize(""));
  });

  test("test_featurize_isDeterministic", () => {
    const raw = "Find the longest contiguous subarray.\n\nConstraints:\n1 <= n <= 10^5\n";
    assert.deepEqual(featureNames(raw), featureNames(raw));
  });
});
