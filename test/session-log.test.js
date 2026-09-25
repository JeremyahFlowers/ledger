// A live session as an event log (js/session-log.js).
//
// This is stage 1 of docs/realtime-architecture.md. The whole reason the app
// represents a session as identified events rather than as state snapshots is
// that two transports with different latencies cannot share snapshots — the
// slow one arrives carrying an older whole-world and overwrites what the fast
// one just did. With events there is nothing to overwrite, and applying one
// twice is a no-op.
//
// That property is not a nice-to-have, it is the load-bearing claim, so §6 of
// the design lists the invariants that have to hold before any of it is
// trusted. They are the first five describes below, in order.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  makeEvent, mergeLogs, ordered, reduce, emptyState, elapsedMs, compact,
  deviceId, COMPACT_ABOVE, KINDS,
} from "../js/session-log.js";

const ev = (seq, kind, payload = {}, at = 1000 + seq, device = "d1") =>
  makeEvent({ sessionId: "s1", deviceId: device, seq, kind, payload, at });

const stroke = (seq, at, device = "d1", color = "#000") =>
  ev(seq, "stroke", { color, width: 3, points: [[seq, seq]] }, at, device);

const boardOf = (log) => reduce(log).strokes.map((s) => s.id);

describe("invariant 1: replaying a log twice is the same as replaying it once", () => {
  const log = [
    ev(0, "session", { problemId: "p1", difficulty: "Medium" }, 100),
    ev(1, "timer", { action: "start" }, 200),
    stroke(2, 300), stroke(3, 400),
    ev(4, "code", { text: "def f(): pass", lang: "python" }, 500),
  ];

  test("test_log_replayingTwiceChangesNothing", () => {
    assert.deepEqual(reduce([...log, ...log]), reduce(log));
  });

  test("test_log_aDuplicateEventIsNotAppliedTwice", () => {
    // The concrete case: the durable channel and the live channel both deliver
    // the same stroke, which is the normal case, not an error.
    assert.equal(reduce([...log, log[2]]).strokes.length, 2);
  });

  test("test_log_duplicatesAreIdentifiedById", () => {
    assert.equal(mergeLogs(log, log).length, log.length);
  });
});

describe("invariant 2: two devices' logs merge to the same board either way", () => {
  const mine = [stroke(0, 100), stroke(1, 300)];
  const theirs = [stroke(0, 200, "d2"), stroke(1, 400, "d2")];

  test("test_log_mergeIsCommutative", () => {
    assert.deepEqual(reduce([...mine, ...theirs]), reduce([...theirs, ...mine]));
  });

  test("test_log_strokesFromBothDevicesAllSurvive", () => {
    // Drawing is append-only, so the union is simply the right answer — this is
    // why the whiteboard is the surface to do first.
    assert.equal(reduce([...mine, ...theirs]).strokes.length, 4);
  });

  test("test_log_orderIsByInstantNotByArrival", () => {
    assert.deepEqual(boardOf([...theirs, ...mine]), ["d1-0", "d2-0", "d1-1", "d2-1"]);
  });

  test("test_log_sameInstantOnTwoDevices_stillOrdersTheSameOnBoth", () => {
    // Without a tie-break the order would depend on which arrived first, which
    // differs per device — and then the two screens disagree.
    const a = stroke(7, 500, "aaa");
    const b = stroke(7, 500, "zzz");
    assert.deepEqual(boardOf([a, b]), boardOf([b, a]));
  });

  test("test_log_anUndoFromOneDeviceRemovesTheOthersStroke", () => {
    const target = stroke(0, 100, "d1");
    const undo = ev(0, "stroke-undo", { strokeId: target.id }, 200, "d2");
    assert.deepEqual(reduce([target, undo]).strokes, []);
  });
});

describe("invariant 3: a stroke that reached the durable channel is never lost", () => {
  test("test_log_compactionPreservesTheBoardExactly", () => {
    const log = [ev(0, "session", { problemId: "p" }, 1)];
    for (let i = 0; i < COMPACT_ABOVE + 100; i++) log.push(stroke(10 + i, 2000 + i));
    const compacted = compact(log);
    assert.ok(compacted.length < log.length, "nothing was compacted");
    assert.deepEqual(reduce(compacted).strokes.map((s) => s.points),
      reduce(log).strokes.map((s) => s.points));
  });

  test("test_log_compactionKeepsWhatIsNotTheBoard", () => {
    // The session event and the timer are tiny and irreplaceable; only strokes
    // are worth collapsing.
    const log = [ev(0, "session", { problemId: "p", difficulty: "Hard" }, 1),
      ev(1, "timer", { action: "start" }, 2)];
    for (let i = 0; i < COMPACT_ABOVE + 60; i++) log.push(stroke(10 + i, 2000 + i));
    const state = reduce(compact(log));
    assert.equal(state.problemId, "p");
    assert.equal(state.difficulty, "Hard");
    assert.equal(state.startedAt, 2);
  });

  test("test_log_aLateEventAlreadyInTheSnapshotIsNotDrawnTwice", () => {
    // A device that was offline sends a stroke the snapshot already contains.
    // Without the absorbed high-water mark it would be appended again.
    const log = [];
    for (let i = 0; i < COMPACT_ABOVE + 60; i++) log.push(stroke(i, 1000 + i));
    const compacted = compact(log);
    const late = log[5];
    assert.equal(reduce([...compacted, late]).strokes.length, reduce(compacted).strokes.length);
  });

  test("test_log_aLateEventNewerThanTheSnapshotIsStillApplied", () => {
    // The other half: absorbing must not become a reason to drop real work.
    const log = [];
    for (let i = 0; i < COMPACT_ABOVE + 60; i++) log.push(stroke(i, 1000 + i));
    const compacted = compact(log);
    const fresh = stroke(9999, 99999, "d2");
    assert.equal(reduce([...compacted, fresh]).strokes.length,
      reduce(compacted).strokes.length + 1);
  });

  test("test_log_aShortLogIsLeftAlone", () => {
    const log = [stroke(0, 100), stroke(1, 200)];
    assert.deepEqual(compact(log), mergeLogs(log));
  });
});

describe("invariant 4: the interviewer's view comes from events alone", () => {
  test("test_log_everythingAViewNeedsIsInTheReducedState", () => {
    const log = [
      ev(0, "session", { problemId: "p1", difficulty: "Hard", plan: { totalMin: 60 } }, 100),
      ev(1, "timer", { action: "start" }, 200),
      stroke(2, 300),
      ev(3, "code", { text: "x = 1", lang: "python" }, 400),
    ];
    const s = reduce(log);
    assert.equal(s.problemId, "p1");
    assert.equal(s.difficulty, "Hard");
    assert.equal(s.plan.totalMin, 60);
    assert.equal(s.startedAt, 200);
    assert.equal(s.strokes.length, 1);
    assert.equal(s.code, "x = 1");
  });

  test("test_log_reducedStateCarriesNothingFromTheUsersWiderLog", () => {
    // The structural guarantee the design rests on: the interviewer receives
    // events from one session, so prior attempts, soul statements and older
    // code have nowhere to leak from.
    const keys = Object.keys(emptyState());
    for (const leak of ["attempts", "problems", "journal", "soulStatement", "settings", "streak"]) {
      assert.ok(!keys.includes(leak), `session state exposes ${leak}`);
    }
  });

  test("test_log_theRubricMergesRatherThanReplacing", () => {
    // An interviewer ticking a fifth box must not clear the four they already
    // ticked, if the events arrive separately.
    const s = reduce([
      ev(0, "rubric", { observed: { 0: true, 1: true } }, 100),
      ev(1, "rubric", { observed: { 4: true } }, 200),
      ev(2, "rubric", { rating: 4 }, 300),
    ]);
    assert.deepEqual(s.rubric, { 0: true, 1: true, 4: true });
    assert.equal(s.rating, 4);
  });

  test("test_log_notesArriveInOrderWithTheirInstants", () => {
    const s = reduce([
      ev(1, "note", { text: "second" }, 200),
      ev(0, "note", { text: "first" }, 100),
    ]);
    assert.deepEqual(s.notes.map((n) => n.text), ["first", "second"]);
    assert.equal(s.notes[0].at, 100);
  });
});

describe("invariant 5: exactly one device holds the code lease", () => {
  test("test_log_theLatestLeaseWins", () => {
    const s = reduce([
      ev(0, "lease", { deviceId: "d1" }, 100),
      ev(1, "lease", { deviceId: "d2" }, 200),
    ]);
    assert.equal(s.lease, "d2");
  });

  test("test_log_anOlderLeaseArrivingLateDoesNotTakeItBack", () => {
    const s = reduce([
      ev(1, "lease", { deviceId: "d2" }, 200),
      ev(0, "lease", { deviceId: "d1" }, 100),
    ]);
    assert.equal(s.lease, "d2");
  });

  test("test_log_thereIsOnlyEverOneLease", () => {
    const s = reduce([
      ev(0, "lease", { deviceId: "d1" }, 100),
      ev(1, "lease", { deviceId: "d2" }, 200),
      ev(2, "lease", { deviceId: "d3" }, 300),
    ]);
    assert.equal(typeof s.lease, "string");
    assert.equal(s.lease, "d3");
  });

  test("test_log_codeIsLastWriterWinsNotLeaseGated", () => {
    // Deliberate. A lease event can arrive late, and losing a snapshot somebody
    // actually typed is a worse failure than briefly accepting one from a
    // device the lease had already moved away from.
    const s = reduce([
      ev(0, "lease", { deviceId: "d2" }, 300),
      ev(1, "code", { text: "typed on d1", lang: "python" }, 400, "d1"),
    ]);
    assert.equal(s.code, "typed on d1");
    assert.equal(s.lease, "d2");
  });

  test("test_log_anOlderCodeSnapshotDoesNotOverwriteANewerOne", () => {
    const s = reduce([
      ev(1, "code", { text: "newer" }, 500),
      ev(0, "code", { text: "older" }, 100),
    ]);
    assert.equal(s.code, "newer");
  });
});

describe("the clock is described by instants, not counted", () => {
  test("test_log_elapsedIsStartToNow", () => {
    const s = reduce([ev(0, "timer", { action: "start" }, 10_000)]);
    assert.equal(elapsedMs(s, 70_000), 60_000);
  });

  test("test_log_pausesAreSubtracted", () => {
    const s = reduce([
      ev(0, "timer", { action: "start" }, 0),
      ev(1, "timer", { action: "pause" }, 10_000),
      ev(2, "timer", { action: "resume" }, 40_000),
    ]);
    assert.equal(elapsedMs(s, 50_000), 20_000);
  });

  test("test_log_whilePausedTheClockDoesNotMove", () => {
    const s = reduce([
      ev(0, "timer", { action: "start" }, 0),
      ev(1, "timer", { action: "pause" }, 10_000),
    ]);
    assert.equal(elapsedMs(s, 999_999), 10_000);
  });

  test("test_log_neverStarted_isZeroNotNegative", () => {
    assert.equal(elapsedMs(emptyState(), 50_000), 0);
  });

  test("test_log_aSecondStartDoesNotRestartTheClock", () => {
    // Two devices can both think they started it.
    const s = reduce([
      ev(0, "timer", { action: "start" }, 1000),
      ev(0, "timer", { action: "start" }, 5000, "d2"),
    ]);
    assert.equal(s.startedAt, 1000);
  });
});

describe("making events", () => {
  test("test_log_idIsDeviceAndSequence", () => {
    assert.equal(makeEvent({ sessionId: "s", deviceId: "abc", seq: 7, kind: "stroke" }).id, "abc-7");
  });

  test("test_log_anUnknownKindIsRefusedLoudly", () => {
    // A typo'd kind would otherwise be an event the reducer silently ignores,
    // which looks exactly like a sync bug.
    assert.throws(() => makeEvent({ sessionId: "s", deviceId: "d", seq: 0, kind: "strokes" }),
      /Unknown event kind/);
  });

  test("test_log_everyKindTheReducerHandlesIsDeclared", () => {
    for (const kind of KINDS) {
      assert.doesNotThrow(() => makeEvent({ sessionId: "s", deviceId: "d", seq: 0, kind }));
    }
  });
});

describe("device identity", () => {
  const fakeStorage = () => {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  };

  test("test_log_theSameBrowserKeepsItsId", () => {
    // How events are deduplicated and how the lease is decided, so it has to
    // survive a reload.
    const s = fakeStorage();
    assert.equal(deviceId(s, "k"), deviceId(s, "k"));
  });

  test("test_log_twoBrowsersGetDifferentIds", () => {
    assert.notEqual(deviceId(fakeStorage(), "k"), deviceId(fakeStorage(), "k"));
  });

  test("test_log_storageRefusing_stillYieldsAUsableId", () => {
    // Private browsing. A session must still work; its events just will not be
    // recognised as this device's after a reload.
    const throwing = { getItem: () => { throw new Error("no"); }, setItem: () => {} };
    assert.match(deviceId(throwing, "k"), /^ephemeral-/);
  });
});

describe("empty and malformed input", () => {
  test("test_log_anEmptyLogReducesToTheEmptyState", () => {
    assert.deepEqual(reduce([]), emptyState());
  });

  test("test_log_mergeToleratesNullLogs", () => {
    assert.deepEqual(mergeLogs(null, undefined, []), []);
  });

  test("test_log_eventsWithoutAnIdAreDropped", () => {
    // Anything could have written the durable file.
    assert.deepEqual(mergeLogs([{ kind: "stroke" }, null, stroke(0, 100)]).map((e) => e.id), ["d1-0"]);
  });

  test("test_log_anUnknownKindInAStoredLogIsIgnoredNotThrownOn", () => {
    const rogue = { id: "x-0", sessionId: "s1", deviceId: "x", seq: 0, at: 100, kind: "nonsense", payload: {} };
    assert.doesNotThrow(() => reduce([rogue, stroke(0, 200)]));
    assert.equal(reduce([rogue, stroke(0, 200)]).strokes.length, 1);
  });

  test("test_log_orderedDoesNotMutateItsInput", () => {
    const log = [stroke(1, 500), stroke(0, 100)];
    const before = log.map((e) => e.id);
    ordered(log);
    assert.deepEqual(log.map((e) => e.id), before);
  });
});
