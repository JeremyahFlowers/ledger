// Tests for exporting one problem's history (js/detail-view.js).
//
// Export was all-or-nothing: the whole log, as JSON, to move your data. There
// was no way to take one problem's story somewhere a person would read it —
// a note to yourself, or a message to someone helping you prepare. Markdown
// rather than JSON for exactly that reason.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { problemToMarkdown } from "../js/detail-view.js";

const state = {
  patterns: [
    { id: "two-pointers", name: "Two Pointers", description: "" },
    { id: "sliding-window", name: "Sliding Window", description: "" },
  ],
  problems: [],
};

const attempt = (over = {}) => ({
  id: "a1", date: "2026-09-01", outcome: "solved-clean", patternGuess: "correct",
  timeToInsightMin: 6, timeToSolveMin: 24, mistakeTags: [], soulStatement: "", ...over,
});

const problem = (over = {}) => ({
  id: "p1", name: "3Sum", number: 15, difficulty: "Medium",
  patternId: "two-pointers", status: "active", box: 1,
  nextReviewDate: "2026-09-20", attempts: [], ...over,
});

describe("problemToMarkdown", () => {
  test("test_export_leadsWithTheProblemAndItsPattern", () => {
    const md = problemToMarkdown(state, problem());
    assert.match(md, /^# 3Sum \(#15\)/);
    assert.match(md, /Pattern: Two Pointers/);
  });

  test("test_export_resolvesPatternNamesRatherThanEmittingIds", () => {
    // "two-pointers" in a document a person reads is a leaked implementation
    // detail.
    const md = problemToMarkdown(state, problem());
    assert.doesNotMatch(md, /two-pointers/);
  });

  test("test_export_includesEachAttemptWithItsOutcome", () => {
    const md = problemToMarkdown(state, problem({
      attempts: [attempt(), attempt({ id: "a2", date: "2026-09-10", outcome: "ran-out-of-time" })],
    }));
    assert.match(md, /### 2026-09-01 — Solved clean/);
    assert.match(md, /### 2026-09-10 — Ran out of time/);
  });

  test("test_export_ordersHistoryOldestFirst", () => {
    // A story reads forwards, unlike the on-screen history which leads with
    // the most recent.
    const md = problemToMarkdown(state, problem({
      attempts: [attempt({ date: "2026-09-10" }), attempt({ id: "a2", date: "2026-09-01" })],
    }));
    assert.ok(md.indexOf("2026-09-01") < md.indexOf("2026-09-10"));
  });

  test("test_export_quotesYourNote", () => {
    const md = problemToMarkdown(state, problem({
      attempts: [attempt({ soulStatement: "the window only shrinks from the left" })] }));
    assert.match(md, /> the window only shrinks from the left/);
  });

  test("test_export_fencesCodeWithItsLanguage", () => {
    const md = problemToMarkdown(state, problem({
      attempts: [attempt({ code: "def f(): pass", codeLang: "python" })] }));
    assert.match(md, /```python\ndef f\(\): pass\n```/);
  });

  test("test_export_namesTheMistakesReadably", () => {
    const md = problemToMarkdown(state, problem({
      attempts: [attempt({ mistakeTags: ["off-by-one", "edge-case-missed"] })] }));
    assert.match(md, /Mistakes: off by one, edge case missed/);
  });

  test("test_export_carriesTheAnalysisWhenThereIsOne", () => {
    const md = problemToMarkdown(state, problem({
      analysis: { at: "2026-09-01", predictions: [{ pattern: "sliding-window", probability: 0.91 }] },
    }));
    assert.match(md, /What I thought going in/);
    assert.match(md, /Sliding Window — 91%/);
  });

  test("test_export_noHistory_saysSoRatherThanEmittingAnEmptySection", () => {
    assert.match(problemToMarkdown(state, problem()), /No attempts recorded yet/);
  });

  test("test_export_problemWithNoNumber_doesNotEmitAnEmptyBracket", () => {
    assert.match(problemToMarkdown(state, problem({ number: null })), /^# 3Sum\n/);
  });

  test("test_export_missingTimings_readAsAbsentNotAsZero", () => {
    const md = problemToMarkdown(state, problem({
      attempts: [attempt({ timeToInsightMin: null, timeToSolveMin: null })] }));
    assert.doesNotMatch(md, /0 min/);
  });
});
