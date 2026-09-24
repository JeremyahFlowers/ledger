// Tests for validating an imported state file (js/logic.js).
//
// Import replaces the entire prep log. It used to accept anything that parsed
// as JSON and apply it with Object.assign — so a truncated download, an
// unrelated file, or a hand-edited one with a wrong shape destroyed every
// problem, attempt and note, and the merge left whatever keys the file omitted
// in place, producing a state half from each.
//
// CLAUDE.md requires validating at the boundary. A file the user picked off
// their disk is that boundary, and these are the cases that must not get past.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { inspectImport, describeState } from "../js/logic.js";

const problem = (over = {}) => ({
  id: "p1", name: "3Sum", number: 15, difficulty: "Medium",
  patternId: "two-pointers", status: "active", box: 0,
  nextReviewDate: "2026-09-20", attempts: [], ...over,
});

const goodFile = (over = {}) => ({
  meta: { schemaVersion: 4, appVersion: "1.0.1", createdAt: "2026-09-18T00:00:00.000Z" },
  settings: { dailyBudgetMin: 75 },
  patterns: [{ id: "two-pointers", name: "Two Pointers", description: "" }],
  problems: [problem()],
  mocks: [], journal: [],
  ...over,
});

describe("inspectImport — files that must be refused", () => {
  test("test_inspectImport_null_isRefused", () => {
    assert.equal(inspectImport(null).ok, false);
  });

  test("test_inspectImport_anArray_isRefused", () => {
    // JSON.parse("[]") succeeds, which is how an unrelated file gets this far.
    assert.equal(inspectImport([]).ok, false);
  });

  test("test_inspectImport_aString_isRefused", () => {
    assert.equal(inspectImport("not a backup").ok, false);
  });

  test("test_inspectImport_someoneElsesJson_isRefused", () => {
    const res = inspectImport({ name: "package", version: "1.0.0", scripts: {} });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => /problems/.test(e)));
  });

  test("test_inspectImport_missingPatterns_isRefused", () => {
    const { patterns, ...rest } = goodFile();
    assert.equal(inspectImport(rest).ok, false);
  });

  test("test_inspectImport_problemWithoutAnId_isRefused", () => {
    // A truncated or hand-edited file. Applying the rest would leave a log
    // that half works.
    const res = inspectImport(goodFile({ problems: [problem(), { name: "no id" }] }));
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => /1 of 2/.test(e)), res.errors.join("|"));
  });

  test("test_inspectImport_unreadableAttemptHistory_isRefused", () => {
    const res = inspectImport(goodFile({ problems: [problem({ attempts: "lots" })] }));
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => /attempt history/.test(e)));
  });

  test("test_inspectImport_refusalAlwaysExplainsWhy", () => {
    // A refusal with no reason is the silent-failure bug in another costume.
    for (const bad of [null, [], "x", {}, goodFile({ problems: [{}] })]) {
      const res = inspectImport(bad);
      assert.equal(res.ok, false);
      assert.ok(res.errors.length > 0 && res.errors.every((e) => e.length > 5),
        "every refusal needs a human-readable reason");
    }
  });
});

describe("inspectImport — files that should be accepted", () => {
  test("test_inspectImport_aRealBackup_isAccepted", () => {
    const res = inspectImport(goodFile());
    assert.equal(res.ok, true);
    assert.deepEqual(res.errors, []);
  });

  test("test_inspectImport_reportsWhatTheFileHolds", () => {
    const res = inspectImport(goodFile({
      problems: [problem({ attempts: [{ id: "a" }, { id: "b" }] }), problem({ id: "p2" })],
    }));
    assert.equal(res.problems, 2);
    assert.equal(res.attempts, 2);
    assert.equal(res.appVersion, "1.0.1");
  });

  test("test_inspectImport_anEmptyButValidLog_isAccepted", () => {
    // A brand new account exporting immediately is a legitimate backup.
    const res = inspectImport(goodFile({ problems: [] }));
    assert.equal(res.ok, true);
    assert.equal(res.problems, 0);
  });

  test("test_inspectImport_olderFileWithoutMeta_isStillAccepted", () => {
    // Migration handles old shapes; import should not reject what the app can
    // still read.
    const { meta, ...rest } = goodFile();
    const res = inspectImport(rest);
    assert.equal(res.ok, true);
    assert.equal(res.appVersion, null);
  });
});

describe("describeState", () => {
  test("test_describeState_countsProblemsAndAttempts", () => {
    assert.equal(
      describeState({ problems: [problem({ attempts: [{ id: "a" }] }), problem({ id: "p2" })] }),
      "2 problems, 1 attempt");
  });

  test("test_describeState_singularReadsNaturally", () => {
    assert.equal(describeState({ problems: [problem()] }), "1 problem, 0 attempts");
  });

  test("test_describeState_emptyOrMissing_doesNotThrow", () => {
    assert.equal(describeState({ problems: [] }), "0 problems, 0 attempts");
    assert.equal(describeState(null), "0 problems, 0 attempts");
  });
});
