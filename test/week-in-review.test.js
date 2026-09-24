// Tests for weekInReview (js/stats.js) and weekToMarkdown (js/progress-view.js).
//
// The rest of the Progress page answers "am I improving", over twelve weeks,
// in rates, and refuses on principle to say anything about a single week —
// which left the app with no answer to the plainer question you have on a
// Sunday evening. This counts instead of rating.
//
// Most of what is pinned here is restraint: a rate that disappears below three
// attempts, minutes that don't claim to cover untimed sessions, a comparison
// that reads as a fact rather than a verdict, and a quiet week that is not
// treated as a failure.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { weekInReview, REVIEW_DAYS } from "../js/stats.js";
import { weekToMarkdown } from "../js/progress-view.js";

const END = "2026-09-24";           // the window is 09-18 .. 09-24 inclusive
const BEFORE = "2026-09-11";        // inside the preceding window

let seq = 0;
const at = (date, over = {}) => ({
  id: `a${seq++}`, date, outcome: "solved-clean", patternGuess: "correct",
  timeToInsightMin: null, timeToSolveMin: null, mistakeTags: [], soulStatement: "", ...over,
});

const prob = (id, attempts, over = {}) => ({
  id, name: id.toUpperCase(), number: null, difficulty: "Medium",
  patternId: "two-pointers", status: "active", box: 0, nextReviewDate: END, attempts, ...over,
});

const st = (problems, over = {}) => ({ problems, mocks: [], journal: [], patterns: [], ...over });

describe("the window", () => {
  test("test_week_endsToday_ratherThanOnACalendarBoundary", () => {
    const w = weekInReview(st([]), END);
    assert.equal(w.endISO, END);
    assert.equal(w.startISO, "2026-09-18");
    assert.equal(w.days, REVIEW_DAYS);
  });

  test("test_week_bothEndsAreInclusive", () => {
    const w = weekInReview(st([prob("p", [at("2026-09-18"), at(END)])]), END);
    assert.equal(w.sessionCount, 2);
  });

  test("test_week_theDayBeforeIsOut", () => {
    assert.equal(weekInReview(st([prob("p", [at("2026-09-17")])]), END).sessionCount, 0);
  });

  test("test_week_countsDaysWorkedNotAttempts", () => {
    // Three attempts on one day is one day of practice.
    const w = weekInReview(st([prob("p", [at(END), at(END), at(END)])]), END);
    assert.equal(w.sessionCount, 3);
    assert.equal(w.activeDays, 1);
  });

  test("test_week_sessionsReadNewestFirst", () => {
    const w = weekInReview(st([prob("p", [at("2026-09-19"), at("2026-09-23")])]), END);
    assert.deepEqual(w.sessions.map((a) => a.date), ["2026-09-23", "2026-09-19"]);
  });
});

describe("what it refuses to claim", () => {
  test("test_week_belowThreeAttempts_reportsNoCleanRate", () => {
    // A 100% week off one attempt is the most misleading thing this could
    // print, and the easiest.
    const w = weekInReview(st([prob("p", [at(END), at(END)])]), END);
    assert.equal(w.cleanRate, null);
    assert.equal(w.cleanCount, 2);
  });

  test("test_week_atThreeAttempts_startsReportingARate", () => {
    const w = weekInReview(st([prob("p", [at(END), at(END), at(END, { outcome: "failed" })])]), END);
    assert.equal(w.cleanRate, 2 / 3);
  });

  test("test_week_minutesCoverOnlyTimedSessions", () => {
    // Most attempts carry no time. Totalling them and calling it the week
    // would say the week was twenty minutes when it was five sessions.
    const w = weekInReview(st([prob("p", [
      at(END, { timeToSolveMin: 20 }), at(END), at(END), at(END), at(END),
    ])]), END);
    assert.equal(w.minutes, 20);
    assert.equal(w.timedCount, 1);
    assert.equal(w.sessionCount, 5);
  });

  test("test_week_zeroMinuteAttemptIsNotCountedAsTimed", () => {
    // Zero is what an unfilled field records, not a session that took no time.
    const w = weekInReview(st([prob("p", [at(END, { timeToSolveMin: 0 })])]), END);
    assert.equal(w.timedCount, 0);
  });

  test("test_week_emptyWeek_isQuietNotZeroed", () => {
    const w = weekInReview(st([]), END);
    assert.equal(w.quiet, true);
    assert.equal(w.cleanRate, null);
  });
});

describe("what moved", () => {
  test("test_week_promotionCountsOnlyWhenTheLastAttemptIsInTheWindow", () => {
    // A box reached last month is not something that moved this week.
    const stale = st([prob("p", [at("2026-08-01")], { box: 3 })]);
    assert.deepEqual(weekInReview(stale, END).promoted, []);
  });

  test("test_week_promotionNeedsACleanSolve", () => {
    const struggled = st([prob("p", [at(END, { outcome: "solved-struggled" })], { box: 2 })]);
    assert.deepEqual(weekInReview(struggled, END).promoted, []);
  });

  test("test_week_promotionNeedsToHaveLeftBoxZero", () => {
    const first = st([prob("p", [at(END)], { box: 0 })]);
    assert.deepEqual(weekInReview(first, END).promoted, []);
  });

  test("test_week_promotionCarriesTheBoxItReached", () => {
    const moved = st([prob("p", [at(END)], { box: 2 })]);
    assert.deepEqual(weekInReview(moved, END).promoted, [{ id: "p", name: "P", box: 2 }]);
  });
});

describe("the comparison with the week before", () => {
  test("test_week_previousWindowIsTheSevenDaysBefore", () => {
    const w = weekInReview(st([prob("p", [at(BEFORE), at(BEFORE)])]), END);
    assert.equal(w.previous.startISO, "2026-09-11");
    assert.equal(w.previous.endISO, "2026-09-17");
    assert.equal(w.previous.sessionCount, 2);
  });

  test("test_week_previousDoesNotLeakIntoThisWeeksCounts", () => {
    const w = weekInReview(st([prob("p", [at(BEFORE), at(END)])]), END);
    assert.equal(w.sessionCount, 1);
    assert.equal(w.previous.sessionCount, 1);
  });
});

describe("what you wrote", () => {
  test("test_week_collectsOnlyNotesThatHaveText", () => {
    const w = weekInReview(st([prob("p", [at(END, { soulStatement: "shrink from the left" }), at(END)])]), END);
    assert.equal(w.notes.length, 1);
    assert.equal(w.notes[0].text, "shrink from the left");
    assert.equal(w.notes[0].problemName, "P");
  });

  test("test_week_picksUpMocksAndJournalFromTheSameWindow", () => {
    const w = weekInReview(st([], { mocks: [{ date: END }, { date: BEFORE }], journal: [{ date: END }] }), END);
    assert.equal(w.mocks.length, 1);
    assert.equal(w.journal.length, 1);
  });

  test("test_week_missingMocksAndJournal_doNotThrow", () => {
    assert.doesNotThrow(() => weekInReview({ problems: [] }, END));
  });
});

describe("weekToMarkdown", () => {
  const state = st([]);

  test("test_weekExport_namesTheRange", () => {
    const md = weekToMarkdown(state, weekInReview(st([prob("p", [at(END)])]), END));
    assert.match(md, /^# Week of 2026-09-18 to 2026-09-24/);
  });

  test("test_weekExport_quietWeek_saysSoInsteadOfEmittingEmptySections", () => {
    const md = weekToMarkdown(state, weekInReview(st([]), END));
    assert.match(md, /Nothing logged this week/);
    assert.doesNotMatch(md, /## What I worked on/);
  });

  test("test_weekExport_belowARate_saysWhyRatherThanPrintingOne", () => {
    const md = weekToMarkdown(state, weekInReview(st([prob("p", [at(END)])]), END));
    assert.match(md, /too few for a rate/);
    assert.doesNotMatch(md, /100%/);
  });

  test("test_weekExport_listsEachSessionWithItsOutcome", () => {
    const md = weekToMarkdown(state, weekInReview(
      st([prob("p", [at(END, { outcome: "ran-out-of-time" })])]), END));
    assert.match(md, /- 2026-09-24 — P: Ran out of time/);
  });

  test("test_weekExport_quotesNotesWithTheirSource", () => {
    const md = weekToMarkdown(state, weekInReview(
      st([prob("p", [at(END, { soulStatement: "shrink from the left" })])]), END));
    assert.match(md, /> shrink from the left/);
    assert.match(md, /> — P, 2026-09-24/);
  });

  test("test_weekExport_untimedSessions_areNotPresentedAsMinutes", () => {
    const md = weekToMarkdown(state, weekInReview(st([prob("p", [at(END)])]), END));
    assert.doesNotMatch(md, /minutes solving/);
  });

  test("test_weekExport_partiallyTimedWeek_saysHowManyItTimed", () => {
    const md = weekToMarkdown(state, weekInReview(
      st([prob("p", [at(END, { timeToSolveMin: 20 }), at(END)])]), END));
    assert.match(md, /across the 1 I timed/);
  });
});
