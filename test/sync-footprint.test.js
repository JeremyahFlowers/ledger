// Tests for the sync size guard (js/logic.js).
//
// The whole log syncs as one file and GitHub refuses anything over 1 MB. That
// is a cliff, not a slope: the save that crosses it fails, and so does every
// save after it, with a raw API error that gives no way to work out what to do.
//
// It was comfortable at ~640 bytes per problem. Analyze now writes pasted
// statements into state at 1-3 KB each — the first thing here that grows
// without bound — so the distance to the wall is worth measuring.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  syncFootprint, formatBytes, SYNC_LIMIT_BYTES, SYNC_WARN_FRACTION, STATUS_ACTIVE,
} from "../js/logic.js";

const problem = (over = {}) => ({
  id: "p1", name: "3Sum", number: 15, difficulty: "Medium", patternId: "two-pointers",
  status: STATUS_ACTIVE, box: 0, nextReviewDate: "2026-09-20", attempts: [], ...over,
});

const state = (problems = []) => ({
  meta: { schemaVersion: 4 }, settings: { dailyBudgetMin: 75 },
  patterns: [], problems, mocks: [], journal: [],
});

describe("syncFootprint", () => {
  test("test_footprint_smallLog_isNowhereNearTheLimit", () => {
    const f = syncFootprint(state([problem()]));
    assert.ok(f.total > 0);
    assert.equal(f.warn, false);
    assert.equal(f.over, false);
  });

  test("test_footprint_attributesStatementsSeparately", () => {
    // The advice has to be specific — "your statements are 400 KB" is
    // actionable, "your data is large" is not.
    const big = "x".repeat(5000);
    const f = syncFootprint(state([problem({ statement: big })]));
    assert.ok(f.breakdown.statements >= 5000, `got ${f.breakdown.statements}`);
    assert.equal(f.counts.withStatement, 1);
  });

  test("test_footprint_attributesSavedCodeSeparately", () => {
    const f = syncFootprint(state([problem({
      attempts: [{ id: "a", date: "2026-09-01", outcome: "solved-clean", code: "y".repeat(3000) }],
    })]));
    assert.ok(f.breakdown.code >= 3000);
    assert.equal(f.counts.attempts, 1);
  });

  test("test_footprint_breakdownDoesNotExceedTheTotal", () => {
    const f = syncFootprint(state([problem({ statement: "s".repeat(500) })]));
    const sum = f.breakdown.statements + f.breakdown.code + f.breakdown.rest;
    assert.ok(sum <= f.total + 2, `${sum} vs ${f.total}`);
    assert.ok(f.breakdown.rest >= 0, "the remainder must never go negative");
  });

  test("test_footprint_warnsBeforeTheWallNotAtIt", () => {
    // Shedding weight has to still be a choice when the warning arrives.
    const filler = "z".repeat(Math.round(SYNC_LIMIT_BYTES * SYNC_WARN_FRACTION));
    const f = syncFootprint(state([problem({ statement: filler })]));
    assert.equal(f.warn, true);
    assert.equal(f.over, false, "warning must come before the limit, not with it");
  });

  test("test_footprint_pastTheLimit_saysSo", () => {
    const filler = "z".repeat(SYNC_LIMIT_BYTES + 1000);
    const f = syncFootprint(state([problem({ statement: filler })]));
    assert.equal(f.over, true);
    assert.ok(f.fraction > 1);
  });

  test("test_footprint_measuresTheJsonNotTheObjects", () => {
    // The limit applies to what is sent, so multi-byte characters have to
    // count as the bytes they encode to.
    const ascii = syncFootprint(state([problem({ statement: "a".repeat(100) })]));
    const wide = syncFootprint(state([problem({ statement: "é".repeat(100) })]));
    assert.ok(wide.breakdown.statements > ascii.breakdown.statements,
      "a two-byte character must count as two bytes");
  });

  test("test_footprint_emptyState_doesNotThrow", () => {
    assert.doesNotThrow(() => syncFootprint(state()));
    assert.doesNotThrow(() => syncFootprint({}));
  });
});

describe("formatBytes", () => {
  test("test_formatBytes_readsNaturallyAtEachScale", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2 KB");
    assert.equal(formatBytes(1024 * 1024), "1.00 MB");
  });

  test("test_formatBytes_zero", () => {
    assert.equal(formatBytes(0), "0 B");
  });
});
