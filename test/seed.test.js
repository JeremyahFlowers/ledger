// Tests for js/seed.js — specifically migrateState, which runs against the
// user's real synced data on every single load.
//
// This is the least forgiving code in the project: it mutates a document that
// holds months of irreplaceable practice history, and there is no undo. Every
// test here is really the same assertion — a migration may add, but it must
// never quietly change or drop something the user earned.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildSeedState, migrateState, PATTERNS } from "../js/seed.js";

/** A state written by an older version of the app, before several fields and
 * eight patterns existed. */
function makeLegacyState(over = {}) {
  return {
    meta: { schemaVersion: 1, createdAt: "2026-01-01T00:00:00.000Z" },
    settings: {
      dailyBudgetMin: 90,
      boxIntervalsDays: [0, 1, 3, 7, 16, 35],
      estimateMinByDifficulty: { Easy: 20, Medium: 30, Hard: 45, Unrated: 30 },
      systemDesignUnlockThreshold: { minMocks: 10, minSolvedCleanRate: 0.7 },
    },
    patterns: [{ id: "two-pointers", name: "Two Pointers", description: "old text" }],
    problems: [{
      id: "p1", name: "3Sum", number: 15, difficulty: "Medium", patternId: "two-pointers",
      approach: "sort then two-pointer", filePath: "two-pointers/3_sum.cpp", notes: "",
      box: 3, nextReviewDate: "2026-06-01",
      attempts: [{ id: "a1", date: "2026-05-01", outcome: "solved-clean", soulStatement: "clicked" }],
    }],
    mocks: [], journal: [],
    systemDesign: { manualUnlock: false, sessions: [] },
    streak: { current: 4, longest: 11, lastActiveDate: "2026-05-01" },
    ...over,
  };
}

describe("buildSeedState", () => {
  test("test_buildSeedState_producesAUsableFirstDay", () => {
    const s = buildSeedState();
    assert.ok(s.problems.length > 0, "an empty app on day one has nothing to practice");
    assert.equal(s.patterns.length, PATTERNS.length);
  });

  test("test_buildSeedState_everyProblemReferencesARealPattern", () => {
    const s = buildSeedState();
    const ids = new Set(s.patterns.map((p) => p.id));
    for (const p of s.problems) {
      assert.ok(ids.has(p.patternId), `${p.name} points at unknown pattern ${p.patternId}`);
    }
  });

  test("test_buildSeedState_patternIdsAreUnique", () => {
    const ids = buildSeedState().patterns.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("migrateState", () => {
  test("test_migrateState_preservesAttemptHistoryExactly", () => {
    const before = makeLegacyState();
    const attemptsBefore = structuredClone(before.problems[0].attempts);
    const after = migrateState(before);
    assert.deepEqual(after.problems[0].attempts, attemptsBefore);
  });

  test("test_migrateState_preservesScheduleAndStreak", () => {
    const after = migrateState(makeLegacyState());
    assert.equal(after.problems[0].box, 3, "review progress must survive a migration");
    assert.equal(after.problems[0].nextReviewDate, "2026-06-01");
    assert.equal(after.streak.longest, 11);
  });

  test("test_migrateState_preservesUserSettings", () => {
    const after = migrateState(makeLegacyState());
    assert.equal(after.settings.dailyBudgetMin, 90, "a customized budget must not be reset to the default");
  });

  test("test_migrateState_backfillsMissingCollections", () => {
    const after = migrateState(makeLegacyState());
    assert.deepEqual(after.resources, {});
    assert.deepEqual(after.whiteboards, []);
    assert.deepEqual(after.quiz, { totalAsked: 0, totalCorrect: 0, recent: [] });
  });

  test("test_migrateState_addsNewPatternsWithoutTouchingExistingOnes", () => {
    const after = migrateState(makeLegacyState());
    const existing = after.patterns.find((p) => p.id === "two-pointers");
    assert.equal(existing.description, "old text",
      "merging by id must not overwrite a pattern the user already has");
    assert.equal(after.patterns.length, PATTERNS.length);
  });

  test("test_migrateState_marksLegacyProblemsActiveNotBacklog", () => {
    // Everything saved before the bank existed was deliberately chosen, so it
    // belongs in the review rotation. Marking it backlog would silently empty
    // the user's queue.
    const after = migrateState(makeLegacyState());
    assert.equal(after.problems[0].status, "active");
  });

  test("test_migrateState_doesNotDowngradeAnAlreadyBankedProblem", () => {
    const state = makeLegacyState();
    state.problems.push({ ...state.problems[0], id: "p2", status: "backlog" });
    const after = migrateState(state);
    assert.equal(after.problems[1].status, "backlog");
  });

  test("test_migrateState_advancesSchemaVersion", () => {
    assert.equal(migrateState(makeLegacyState()).meta.schemaVersion, 4);
  });

  test("test_migrateState_neverLowersSchemaVersion", () => {
    const future = makeLegacyState({ meta: { schemaVersion: 99, createdAt: "x" } });
    assert.equal(migrateState(future).meta.schemaVersion, 99);
  });

  test("test_migrateState_missingMeta_isReconstructed", () => {
    const state = makeLegacyState();
    delete state.meta;
    assert.ok(migrateState(state).meta.schemaVersion >= 4);
  });

  test("test_migrateState_isIdempotent", () => {
    // It runs on every load, so running twice must equal running once.
    const once = migrateState(makeLegacyState());
    const twice = migrateState(structuredClone(once));
    assert.deepEqual(twice, once);
  });

  test("test_migrateState_freshSeedState_passesThroughUnharmed", () => {
    const seeded = buildSeedState();
    const problemCount = seeded.problems.length;
    const after = migrateState(seeded);
    assert.equal(after.problems.length, problemCount);
    assert.equal(after.patterns.length, PATTERNS.length);
  });
});
