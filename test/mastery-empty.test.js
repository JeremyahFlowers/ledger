// What the pattern mastery page says before there is anything to measure.
//
// It renders one row per pattern with mastery, problem count, attempts,
// clean-solve rate, a trend sparkline, recall rate, time to insight and top
// mistake. Before a single logged session, six of those nine columns are an em
// dash and the ring reads "–": twenty-three rows of nothing, formatted as
// data, on the page whose stated job is to say what to focus on next.
//
// It cannot do that job yet. Saying so is more useful than a ranked table of
// zeroes, which implies the answer is "everything, equally".

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { patternStats } from "../js/logic.js";

const src = readFileSync(fileURLToPath(new URL("../js/views.js", import.meta.url)), "utf8");
const fn = src.slice(src.indexOf("export function renderPatterns("), src.indexOf("function wireTopicRows("));

describe("before anything is logged", () => {
  test("test_mastery_emptyPath_isTakenWhenNoPatternHasAttempts", () => {
    assert.match(fn, /const worked = stats\.filter\(\(s\) => s\.attempts > 0\)/);
    assert.match(fn, /if \(!worked\.length\)/);
  });

  test("test_mastery_emptyPath_offersTheActionThatEndsIt", () => {
    // Cycle 4's rule: an empty state names the one thing that starts it.
    const empty = fn.slice(fn.indexOf("if (!worked.length)"), fn.indexOf("root.innerHTML = `\n    <div class=\"card\">\n      <h2>Pattern mastery</h2>\n      <p class=\"muted\">Weakest"));
    assert.match(empty, /emptyState\(/);
    assert.match(empty, /tab: "queue"/);
  });

  test("test_mastery_emptyPath_doesNotRenderTheTable", () => {
    const empty = fn.slice(fn.indexOf("if (!worked.length)"), fn.indexOf("return;\n  }"));
    assert.doesNotMatch(empty, /<table/);
  });

  test("test_mastery_emptyPath_stillWiresTheTopicLinks", () => {
    // It offers a way into the topic pages, and a button that does nothing is
    // worse than no button — the exact shape of the save bug.
    const empty = fn.slice(fn.indexOf("if (!worked.length)"), fn.indexOf("return;\n  }"));
    assert.match(empty, /wireTopicRows\(root, actions\)/);
  });
});

describe("once some patterns have been worked and others haven't", () => {
  const state = {
    patterns: [
      { id: "a", name: "A", description: "" },
      { id: "b", name: "B", description: "" },
    ],
    problems: [{
      id: "p", name: "P", number: 1, difficulty: "Medium", patternId: "a",
      status: "active", box: 1, nextReviewDate: "2026-09-24",
      attempts: [{ id: "x", date: "2026-09-20", outcome: "solved-clean", patternGuess: "correct",
        timeToInsightMin: 5, timeToSolveMin: 20, mistakeTags: [], soulStatement: "" }],
    }],
  };

  test("test_mastery_untouchedPatternsSortToTheBottom", () => {
    // Not to the top. Weakest-first with a null rate treated as zero would put
    // every pattern you have never tried above the ones you actually struggle
    // with, which inverts the whole point of the page.
    const sorted = patternStats(state).sort((x, y) => (x.solvedCleanRate ?? 1) - (y.solvedCleanRate ?? 1));
    assert.equal(sorted[sorted.length - 1].pattern.id, "b");
  });

  test("test_mastery_saysHowManyAreUnranked", () => {
    assert.match(fn, /have nothing logged against them yet and sit at the bottom/);
  });

  test("test_mastery_saysAnUntouchedPatternIsNotAWeakOne", () => {
    // The sentence exists so a bottom-of-the-table position is not read as a
    // verdict.
    assert.match(fn, /an untouched pattern is not a weak one/i);
  });
});
