// Tests for mockReview (js/stats.js).
//
// A mock records five interview behaviours — clarify the constraints, state
// the approach out loud, narrate trade-offs, give complexity unprompted, test
// before declaring done — and every one of them was written down and never
// read again. state.mocks fed exactly one thing: the ring that unlocks the
// system design track.
//
// That is the wrong half to keep. Whether you solved it is already recorded on
// the attempt. The mock exists for the part that only happens when someone is
// watching, and the checklist is the only record of that anywhere in the app.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { mockReview, MOCK_WINDOW, MOCK_MIN } from "../js/stats.js";

const ITEMS = ["Clarified constraints", "Stated approach", "Narrated trade-offs",
  "Stated complexity", "Tested first"];

/** A mock that ticked the boxes at `indexes`. */
const mock = (indexes = [], over = {}) => ({
  id: "m", date: "2026-09-01", problemId: "p", outcome: "solved-clean",
  communicationRating: null, durationActualMin: null, notes: "",
  checklist: Object.fromEntries(indexes.map((i) => [i, true])),
  ...over,
});
const st = (mocks) => ({ mocks });

describe("per-behaviour rates", () => {
  test("test_mockReview_countsATickedBox", () => {
    const r = mockReview(st([mock([0]), mock([0]), mock([0])]), ITEMS);
    assert.equal(r.habits[0].done, 3);
    assert.equal(r.habits[0].rate, 1);
  });

  test("test_mockReview_anAbsentKeyCountsAsNotDone", () => {
    // The checklist is sparse — an unticked box is simply missing — which is
    // exactly what it meant when the box was left alone.
    const r = mockReview(st([mock([]), mock([]), mock([])]), ITEMS);
    assert.equal(r.habits[2].done, 0);
    assert.equal(r.habits[2].rate, 0);
  });

  test("test_mockReview_missingChecklistEntirely_doesNotThrow", () => {
    const r = mockReview(st([mock([], { checklist: undefined }), mock([0]), mock([0])]), ITEMS);
    assert.equal(r.habits[0].done, 2);
  });

  test("test_mockReview_oneRowPerBehaviour_inTheOrderGiven", () => {
    const r = mockReview(st([mock(), mock(), mock()]), ITEMS);
    assert.deepEqual(r.habits.map((h) => h.label), ITEMS);
  });
});

describe("what it refuses to claim", () => {
  test("test_mockReview_belowTheMinimum_reportsNoRates", () => {
    // Five rates over two mocks is a verdict on one bad morning.
    const r = mockReview(st([mock([0]), mock([0])]), ITEMS);
    assert.equal(r.enough, false);
    assert.ok(r.habits.every((h) => h.rate === null));
    assert.equal(r.needed, MOCK_MIN - 2);
  });

  test("test_mockReview_atTheMinimum_startsReporting", () => {
    const r = mockReview(st(Array.from({ length: MOCK_MIN }, () => mock([1]))), ITEMS);
    assert.equal(r.enough, true);
    assert.equal(r.habits[1].rate, 1);
  });

  test("test_mockReview_allHabitsEqual_namesNoWeakest", () => {
    // Five behaviours at the same rate has no weakest one; it has a number,
    // and picking one anyway would send someone to work on nothing.
    const r = mockReview(st([mock([0, 1, 2, 3, 4]), mock([0, 1, 2, 3, 4]), mock([0, 1, 2, 3, 4])]), ITEMS);
    assert.equal(r.weakest, null);
    assert.equal(r.strongest, null);
  });

  test("test_mockReview_namesTheWeakestWhenThereIsAGap", () => {
    const r = mockReview(st([mock([0, 1, 2, 3]), mock([0, 1, 2, 3]), mock([0, 1, 2, 3])]), ITEMS);
    assert.equal(r.weakest.index, 4);
    assert.equal(r.weakest.rate, 0);
    assert.equal(r.strongest.rate, 1);
  });

  test("test_mockReview_unratedCommunication_isAbsentNotZero", () => {
    const r = mockReview(st([mock(), mock(), mock()]), ITEMS);
    assert.equal(r.avgCommunication, null);
    assert.equal(r.commsCount, 0);
  });

  test("test_mockReview_averagesOnlyTheRatedOnes", () => {
    const r = mockReview(st([
      mock([], { communicationRating: 4 }), mock([], { communicationRating: 2 }), mock(),
    ]), ITEMS);
    assert.equal(r.avgCommunication, 3);
    assert.equal(r.commsCount, 2);
  });

  test("test_mockReview_zeroMinutes_isNotADuration", () => {
    const r = mockReview(st([
      mock([], { durationActualMin: 0 }), mock([], { durationActualMin: 40 }), mock(),
    ]), ITEMS);
    assert.equal(r.medianMinutes, 40);
  });
});

describe("the window", () => {
  test("test_mockReview_looksAtRecentMocksOnly", () => {
    // A habit you fixed four months ago is not what you want to be shown.
    const old = Array.from({ length: MOCK_WINDOW }, () => mock([]));
    const recent = Array.from({ length: MOCK_WINDOW }, () => mock([0]));
    const r = mockReview(st([...old, ...recent]), ITEMS);
    assert.equal(r.counted, MOCK_WINDOW);
    assert.equal(r.habits[0].rate, 1);
  });

  test("test_mockReview_reportsTheLifetimeTotalAlongsideTheWindow", () => {
    const r = mockReview(st(Array.from({ length: MOCK_WINDOW + 5 }, () => mock([0]))), ITEMS);
    assert.equal(r.total, MOCK_WINDOW + 5);
    assert.equal(r.counted, MOCK_WINDOW);
  });

  test("test_mockReview_noMocksAtAll_doesNotThrow", () => {
    assert.equal(mockReview({ mocks: [] }, ITEMS).total, 0);
    assert.equal(mockReview({}, ITEMS).total, 0);
  });
});
