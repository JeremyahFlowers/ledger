// Tests for checkpointing an in-progress session (js/session-store.js).
//
// The failure this prevents: `session` was module state and nothing else, so a
// refresh, a followed link, or a phone evicting a background tab discarded the
// timer, the typed code and the whiteboard with no warning. The app asks
// people to work in one tab for an hour; it has to survive that hour.
//
// The arithmetic matters as much as the storage. A checkpoint restored
// verbatim after an overnight tab would show a nine-hour session, which is
// worse than losing it — it is a plausible-looking wrong number that then
// lands in the permanent record.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { adjustedStart, isResumable, snapshotOf } from "../js/session-store.js";

const MIN = 60000;
const HOUR = 60 * MIN;

describe("adjustedStart", () => {
  test("test_adjustedStart_immediateReload_leavesTheClockWhereItWas", () => {
    const start = 1000;
    const snap = { startedAt: start, savedAt: start + 10 * MIN };
    // Reloaded the instant it was saved: nothing was missed.
    assert.equal(adjustedStart(snap, start + 10 * MIN), start);
  });

  test("test_adjustedStart_timeAwayIsNotCountedAsWork", () => {
    // Started at 0, checkpointed at 10 min, reopened an hour later. Elapsed on
    // screen must still read 10 minutes, not 70.
    const snap = { startedAt: 0, savedAt: 10 * MIN };
    const now = 10 * MIN + HOUR;
    assert.equal(now - adjustedStart(snap, now), 10 * MIN);
  });

  test("test_adjustedStart_overnightGap_doesNotInventHours", () => {
    const snap = { startedAt: 0, savedAt: 25 * MIN };
    const now = 25 * MIN + 9 * HOUR;
    assert.equal(now - adjustedStart(snap, now), 25 * MIN);
  });

  test("test_adjustedStart_clockSkewBackwards_neverRunsTheClockBackwards", () => {
    // A machine whose clock moved back would otherwise produce a negative gap
    // and inflate the elapsed time.
    const snap = { startedAt: 0, savedAt: 10 * MIN };
    assert.equal(adjustedStart(snap, 5 * MIN), 0);
  });

  test("test_adjustedStart_missingSavedAt_fallsBackToTheOriginalStart", () => {
    assert.equal(adjustedStart({ startedAt: 42 }, 999), 42);
  });

  test("test_adjustedStart_neverStarted_isNull", () => {
    assert.equal(adjustedStart({ savedAt: 1 }, 2), null);
  });
});

describe("isResumable", () => {
  test("test_isResumable_recentCheckpoint_yes", () => {
    assert.equal(isResumable({ savedAt: 0 }, 2 * HOUR), true);
  });

  test("test_isResumable_daysOld_no", () => {
    // Past a day it is abandoned, not interrupted, and putting it back in
    // front of someone who has moved on is worse than dropping it.
    assert.equal(isResumable({ savedAt: 0 }, 30 * HOUR), false);
  });

  test("test_isResumable_nothingStored_no", () => {
    assert.equal(isResumable(null, 1), false);
    assert.equal(isResumable({}, 1), false);
  });
});

describe("snapshotOf", () => {
  const session = () => ({
    problem: { id: "p1", name: "3Sum" },
    isMock: false,
    startedAt: 1000,
    insightAt: 2000,
    codeLang: "python",
    capturedCode: "x = 1",
    checklist: { 0: true },
    whiteboardShown: true,
    whiteboardCtl: { toJSON: () => [{ color: "#fff", width: 3, points: [1, 2] }] },
  });

  test("test_snapshotOf_storesTheProblemByIdNotByValue", () => {
    // The live object is a reference into synced state; writing a copy back on
    // restore would resurrect whatever it looked like when the session began.
    const snap = snapshotOf(session());
    assert.equal(snap.problemId, "p1");
    assert.equal(snap.problem, undefined);
  });

  test("test_snapshotOf_prefersLiveEditorContentOverTheCapturedCopy", () => {
    const s = { ...session(), cm: { getValue: () => "live text" } };
    assert.equal(snapshotOf(s).code, "live text");
  });

  test("test_snapshotOf_withoutAnEditor_fallsBackToCapturedCode", () => {
    assert.equal(snapshotOf(session()).code, "x = 1");
  });

  test("test_snapshotOf_includesTheDrawing", () => {
    assert.equal(snapshotOf(session()).whiteboard.length, 1);
  });

  test("test_snapshotOf_boardNotYetOpened_isAnEmptyDrawingNotAThrow", () => {
    const s = { ...session(), whiteboardCtl: null };
    assert.deepEqual(snapshotOf(s).whiteboard, []);
  });

  test("test_snapshotOf_noSession_isNull", () => {
    assert.equal(snapshotOf(null), null);
    assert.equal(snapshotOf({}), null);
  });

  test("test_snapshotOf_recordsWhenItWasTaken", () => {
    assert.equal(snapshotOf(session(), 12345).savedAt, 12345);
  });
});

describe("a checkpoint must never erase what it is recovering", () => {
  // Found by reloading twice: a checkpoint can fire before the whiteboard has
  // mounted — a restored session writes its code after a second of typing,
  // and the canvas may not exist yet. Reading the drawing off a controller
  // that isn't there yielded [], which then overwrote the drawing still
  // waiting to be replayed. The feature built to stop work being lost was
  // losing it.
  test("test_snapshotOf_boardNotYetMounted_keepsTheDrawingAwaitingReplay", () => {
    const pending = [{ color: "#fff", width: 3, points: [1, 2, 3] }];
    const snap = snapshotOf({
      problem: { id: "p1" }, startedAt: 1, checklist: {},
      whiteboardCtl: null, restoredBoard: pending,
    });
    assert.deepEqual(snap.whiteboard, pending);
  });

  test("test_snapshotOf_onceMounted_theLiveBoardWins", () => {
    // After replay the controller is the truth; the pending copy is stale.
    const snap = snapshotOf({
      problem: { id: "p1" }, startedAt: 1, checklist: {},
      whiteboardCtl: { toJSON: () => [] },
      restoredBoard: [{ color: "#fff", width: 3, points: [9] }],
    });
    assert.deepEqual(snap.whiteboard, [], "a board cleared by the user must stay cleared");
  });

  test("test_snapshotOf_freshSessionNeverOpenedTheBoard_isEmpty", () => {
    const snap = snapshotOf({ problem: { id: "p1" }, startedAt: 1, checklist: {} });
    assert.deepEqual(snap.whiteboard, []);
  });
});
