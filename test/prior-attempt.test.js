// What a session shows you about your last attempt (js/logic.js).
//
// Reopening a problem you failed last week gave you the statement and an empty
// editor. Your old code was already reachable behind a closed <details> in the
// code pane, deliberately shut, because handing you your own solution before
// you have tried is the one thing this app exists to prevent.
//
// The same reasoning splits everything else in two, and that split is what
// these tests pin. What you *scored* — the outcome, the timings, the mistakes
// you tagged — warns you without telling you the approach, so it leads. Your
// soul statement does tell you the approach: "the window only shrinks from the
// left" is the answer written down, so it stays behind the fold.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { priorAttemptSummary } from "../js/logic.js";

const attempt = (over = {}) => ({
  id: "a1", date: "2026-09-10", outcome: "failed", patternGuess: "incorrect",
  timeToInsightMin: 18, timeToSolveMin: 45, mistakeTags: [], soulStatement: "", ...over,
});
const problem = (attempts) => ({
  id: "p1", name: "3Sum", number: 15, difficulty: "Medium", patternId: "two-pointers",
  status: "active", box: 0, nextReviewDate: "2026-09-24", attempts,
});

describe("what it reports", () => {
  test("test_prior_usesTheMostRecentAttempt", () => {
    const s = priorAttemptSummary(problem([
      attempt({ date: "2026-09-01", outcome: "solved-clean" }),
      attempt({ date: "2026-09-10", outcome: "failed" }),
    ]));
    assert.equal(s.date, "2026-09-10");
    assert.equal(s.outcome, "failed");
  });

  test("test_prior_unorderedAttempts_stillFindTheLatest", () => {
    // Nothing guarantees order in a file that has been merged or hand-edited.
    const s = priorAttemptSummary(problem([attempt({ date: "2026-09-10" }), attempt({ date: "2026-09-01" })]));
    assert.equal(s.date, "2026-09-10");
  });

  test("test_prior_countsHowManyAttemptsThereHaveBeen", () => {
    assert.equal(priorAttemptSummary(problem([attempt(), attempt(), attempt()])).attemptNumber, 3);
  });

  test("test_prior_carriesTheMistakesToWatchFor", () => {
    // The most useful part and the least dangerous: a thing to watch for is
    // not a solution.
    const s = priorAttemptSummary(problem([attempt({ mistakeTags: ["off-by-one", "edge-case-missed"] })]));
    assert.deepEqual(s.mistakeTags, ["off-by-one", "edge-case-missed"]);
  });

  test("test_prior_saysWhetherYouNamedThePattern", () => {
    assert.equal(priorAttemptSummary(problem([attempt({ patternGuess: "correct" })])).recalledPattern, true);
    assert.equal(priorAttemptSummary(problem([attempt({ patternGuess: "incorrect" })])).recalledPattern, false);
  });
});

describe("what it refuses to invent", () => {
  test("test_prior_noAttemptsYet_isNull", () => {
    // A first rep shows nothing, rather than an empty frame.
    assert.equal(priorAttemptSummary(problem([])), null);
  });

  test("test_prior_missingAttemptsArray_doesNotThrow", () => {
    assert.equal(priorAttemptSummary({ name: "P" }), null);
    assert.equal(priorAttemptSummary(undefined), null);
  });

  test("test_prior_anUndatedAttempt_isNotTheLastOne", () => {
    // It cannot be ordered, so it cannot be "last time".
    const s = priorAttemptSummary(problem([{ ...attempt({ date: null }) }, attempt({ date: "2026-09-01" })]));
    assert.equal(s.date, "2026-09-01");
  });

  test("test_prior_missingTimings_areNullNotZero", () => {
    const s = priorAttemptSummary(problem([attempt({ timeToInsightMin: null, timeToSolveMin: null })]));
    assert.equal(s.timeToInsightMin, null);
    assert.equal(s.timeToSolveMin, null);
  });

  test("test_prior_zeroSolveTime_readsAsUnrecorded", () => {
    // Zero is what an unfilled field records, not a session that took no time.
    assert.equal(priorAttemptSummary(problem([attempt({ timeToSolveMin: 0 })])).timeToSolveMin, null);
  });

  test("test_prior_zeroInsightTime_isARealValue", () => {
    // Unlike a solve time, knowing the approach instantly is a real thing that
    // happens on a problem you have seen before.
    assert.equal(priorAttemptSummary(problem([attempt({ timeToInsightMin: 0 })])).timeToInsightMin, 0);
  });

  test("test_prior_mistakeTagsThatArentAList_doNotBreakIt", () => {
    assert.deepEqual(priorAttemptSummary(problem([attempt({ mistakeTags: undefined })])).mistakeTags, []);
  });
});

describe("the note stays behind the fold", () => {
  const src = readFileSync(fileURLToPath(new URL("../js/session-view.js", import.meta.url)), "utf8");

  test("test_prior_summaryReportsWhetherThereIsANoteWithoutLeadingWithIt", () => {
    const s = priorAttemptSummary(problem([attempt({ soulStatement: "shrinks from the left" })]));
    assert.equal(s.note, "shrinks from the left");
  });

  test("test_prior_theUpFrontBlockNeverPrintsTheNote", () => {
    // The guard that matters: priorHtml must not render prior.note.
    const fn = src.slice(src.indexOf("function priorHtml("));
    const body = fn.slice(0, fn.indexOf("\nconst OUTCOME_PILL"));
    assert.doesNotMatch(body, /\$\{esc\(prior\.note\)\}/);
    assert.doesNotMatch(body, /richText\(prior\.note\)/);
  });

  test("test_prior_theNoteIsRenderedInsideTheClosedDetails", () => {
    const details = src.slice(src.indexOf("<details class=\"ws-prior-code\">"));
    assert.match(details.slice(0, 600), /ws-prior-note/);
    assert.match(details.slice(0, 600), /soulStatement/);
  });

  test("test_prior_theDetailsIsNotOpenByDefault", () => {
    // One `open` attribute would undo the whole decision.
    assert.doesNotMatch(src, /<details class="ws-prior-code" open/);
  });

  test("test_prior_theUpFrontBlockDoesMentionTheMistakes", () => {
    const fn = src.slice(src.indexOf("function priorHtml("));
    assert.match(fn.slice(0, fn.indexOf("\nconst OUTCOME_PILL")), /mistakeTags/);
  });
});
