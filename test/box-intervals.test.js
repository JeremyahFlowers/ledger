// Tests for editable review intervals (js/logic.js).
//
// boxIntervalsDays decides when each box comes back round. It was honoured
// everywhere while being changeable only by hand-editing JSON — the one number
// that defines what this app is, and the one you couldn't touch.
//
// It is guarded rather than merely accepted, because a bad table is not a bad
// preference: it is a schedule that stops working, silently, days later.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  parseBoxIntervals, validateBoxIntervals,
  MIN_BOX_INTERVALS, MAX_BOX_INTERVALS, MAX_BOX_INTERVAL_DAYS,
} from "../js/logic.js";

describe("parseBoxIntervals", () => {
  test("test_parse_commaSeparated", () => {
    assert.deepEqual(parseBoxIntervals("0, 1, 3, 7"), [0, 1, 3, 7]);
  });

  test("test_parse_toleratesUntidySpacing", () => {
    assert.deepEqual(parseBoxIntervals(" 0 ,1,  3 "), [0, 1, 3]);
  });

  test("test_parse_ignoresTrailingSeparators", () => {
    assert.deepEqual(parseBoxIntervals("0,1,3,"), [0, 1, 3]);
  });

  test("test_parse_nonNumbersBecomeNaNSoValidationCanRejectThem", () => {
    // Deliberately not dropped: silently ignoring "three" would save a
    // different schedule than the one that was typed.
    const out = parseBoxIntervals("0, three, 7");
    assert.equal(out.length, 3);
    assert.ok(Number.isNaN(out[1]));
  });

  test("test_parse_decimalsAreNotWholeDays", () => {
    assert.ok(Number.isNaN(parseBoxIntervals("0, 1.5")[1]));
  });

  test("test_parse_empty_isEmpty", () => {
    assert.deepEqual(parseBoxIntervals(""), []);
    assert.deepEqual(parseBoxIntervals(null), []);
  });
});

describe("validateBoxIntervals", () => {
  test("test_validate_aStandardLadder_isAccepted", () => {
    assert.equal(validateBoxIntervals([0, 1, 3, 7, 16, 35]).ok, true);
  });

  test("test_validate_tooFewBoxes_isRefused", () => {
    assert.equal(validateBoxIntervals([0, 1]).ok, false);
    assert.equal(validateBoxIntervals([]).ok, false);
  });

  test("test_validate_tooManyBoxes_isRefused", () => {
    const many = [0, ...Array.from({ length: MAX_BOX_INTERVALS }, (_, i) => i + 1)];
    assert.equal(validateBoxIntervals(many).ok, false);
  });

  test("test_validate_mustStartAtZero", () => {
    // A problem you just failed comes back today, not in two days.
    const res = validateBoxIntervals([2, 3, 7]);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => /first box/.test(e)));
  });

  test("test_validate_mustNotDecrease", () => {
    // A dip would send a problem you solved cleanly back sooner than one you
    // struggled with, which inverts the whole premise.
    const res = validateBoxIntervals([0, 7, 3]);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => /at least as long/.test(e)));
  });

  test("test_validate_equalIntervals_areAllowed", () => {
    // Non-decreasing, not strictly increasing: a flat tail is a legitimate
    // choice for someone who wants a steady cadence.
    assert.equal(validateBoxIntervals([0, 7, 7, 7]).ok, true);
  });

  test("test_validate_negativeDays_areRefused", () => {
    assert.equal(validateBoxIntervals([0, -1, 3]).ok, false);
  });

  test("test_validate_nonIntegers_areRefused", () => {
    assert.equal(validateBoxIntervals([0, NaN, 3]).ok, false);
    assert.equal(validateBoxIntervals([0, 1.5, 3]).ok, false);
  });

  test("test_validate_absurdlyLongWaits_areRefused", () => {
    assert.equal(validateBoxIntervals([0, 1, MAX_BOX_INTERVAL_DAYS + 1]).ok, false);
  });

  test("test_validate_refusalAlwaysSaysWhy", () => {
    for (const bad of [[], [2, 3, 7], [0, 7, 3], [0, -1, 3], [0, NaN, 2]]) {
      const res = validateBoxIntervals(bad);
      assert.equal(res.ok, false);
      assert.ok(res.errors.length > 0 && res.errors.every((e) => e.length > 10),
        `no usable reason for ${JSON.stringify(bad)}`);
    }
  });

  test("test_validate_notAnArray_isRefusedNotThrown", () => {
    assert.equal(validateBoxIntervals(null).ok, false);
    assert.equal(validateBoxIntervals("0,1,3").ok, false);
  });
});
