// The questions to ask before writing a line (js/clarify.js).
//
// Every question is paired with the design decision its answer settles —
// that pairing is the habit being built, so these check it is never missing —
// and the drill reports which *kinds* of question get skipped, because "you
// never ask about duplicates" is actionable and "you missed question four" is
// not.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  CLARIFY_KINDS, CLARIFY_PROMPTS, CLARIFY_MEMORY, HABIT_MIN,
  promptById, pickClarifyPrompt, recordClarify, clarifyStats, blindKinds, clarifyToday,
} from "../js/clarify.js";

const TODAY = "2026-09-29";
const makeSubject = (log = []) => ({ clarify: { log: [...log] } });

describe("the prompts", () => {
  test("test_clarify_everyPromptIsActuallyVague", () => {
    // Short on purpose. A prompt that states its constraints leaves nothing
    // to ask.
    for (const p of CLARIFY_PROMPTS) assert.ok(p.prompt.length < 120, `${p.id} gives too much away`);
  });

  test("test_clarify_everyQuestionSaysWhatItsAnswerChanges", () => {
    for (const p of CLARIFY_PROMPTS) {
      for (const q of p.questions) {
        assert.ok(q.q.endsWith("?"), `${p.id}: "${q.q}" is not a question`);
        assert.ok(q.changes.length > 30, `${p.id}: "${q.q}" does not say what it settles`);
      }
    }
  });

  test("test_clarify_everyQuestionHasAKnownKind", () => {
    for (const p of CLARIFY_PROMPTS) {
      for (const q of p.questions) assert.ok(CLARIFY_KINDS[q.kind], `${p.id}: unknown kind "${q.kind}"`);
    }
  });

  test("test_clarify_everyPromptHasEnoughToAsk", () => {
    for (const p of CLARIFY_PROMPTS) assert.ok(p.questions.length >= 5, `${p.id} has ${p.questions.length}`);
  });

  test("test_clarify_everyPromptCoversSeveralKinds", () => {
    // One prompt that is all "what to return" teaches one habit.
    for (const p of CLARIFY_PROMPTS) {
      assert.ok(new Set(p.questions.map((q) => q.kind)).size >= 3, `${p.id} is one-dimensional`);
    }
  });

  test("test_clarify_everyKindComesUpInSeveralPrompts", () => {
    // Or the drill can never tell a habit from a one-off.
    for (const kind of Object.keys(CLARIFY_KINDS)) {
      const n = CLARIFY_PROMPTS.filter((p) => p.questions.some((q) => q.kind === kind)).length;
      assert.ok(n >= 2, `"${kind}" appears in only ${n} prompt`);
    }
  });

  test("test_clarify_idsAreUnique", () => {
    assert.equal(new Set(CLARIFY_PROMPTS.map((p) => p.id)).size, CLARIFY_PROMPTS.length);
  });

  test("test_clarify_promptById_unknownIsNull", () => {
    assert.equal(promptById("nonsense"), null);
  });
});

describe("which prompt comes next", () => {
  test("test_clarify_neverSeenComesFirst", () => {
    const log = CLARIFY_PROMPTS.slice(1).map((p) => ({ id: p.id, date: TODAY, asked: [] }));
    assert.equal(pickClarifyPrompt(makeSubject(log)).id, CLARIFY_PROMPTS[0].id);
  });

  test("test_clarify_thenTheOneSeenLongestAgo", () => {
    const log = CLARIFY_PROMPTS.map((p) => ({ id: p.id, date: TODAY, asked: [] }));
    assert.equal(pickClarifyPrompt(makeSubject(log)).id, CLARIFY_PROMPTS[0].id);
  });

  test("test_clarify_theJustPlayedAreHeldBack", () => {
    const first = pickClarifyPrompt(makeSubject()).id;
    assert.notEqual(pickClarifyPrompt(makeSubject(), [first]).id, first);
  });

  test("test_clarify_holdingEverythingBackStillPicks", () => {
    assert.ok(pickClarifyPrompt(makeSubject(), CLARIFY_PROMPTS.map((p) => p.id)));
  });
});

describe("recording a round", () => {
  test("test_clarify_recordClarify_keepsWhatWasAsked", () => {
    const s = makeSubject();
    recordClarify(s, "two-sum", [2, 0, 2], TODAY);
    assert.deepEqual(s.clarify.log, [{ id: "two-sum", date: TODAY, asked: [0, 2] }]);
  });

  test("test_clarify_recordClarify_dropsIndexesThatAreNotQuestions", () => {
    const s = makeSubject();
    recordClarify(s, "two-sum", [-1, 0, 99, 1.5], TODAY);
    assert.deepEqual(s.clarify.log[0].asked, [0]);
  });

  test("test_clarify_recordClarify_ignoresAnUnknownPrompt", () => {
    const s = makeSubject();
    recordClarify(s, "nonsense", [0], TODAY);
    assert.deepEqual(s.clarify.log, []);
  });

  test("test_clarify_theLogIsBounded", () => {
    const s = makeSubject();
    for (let i = 0; i < CLARIFY_MEMORY + 10; i++) recordClarify(s, "two-sum", [0], TODAY);
    assert.equal(s.clarify.log.length, CLARIFY_MEMORY);
  });

  test("test_clarify_roundsTodayAreCounted", () => {
    const s = makeSubject([{ id: "two-sum", date: "2026-09-01", asked: [] }]);
    recordClarify(s, "maze", [], TODAY);
    assert.equal(clarifyToday(s, TODAY), 1);
  });
});

describe("the habit, not the miss", () => {
  const dupeIndex = (id) => promptById(id).questions.findIndex((q) => q.kind === "duplicates");
  const allBut = (id, kind) => promptById(id).questions
    .map((q, i) => (q.kind === kind ? -1 : i)).filter((i) => i >= 0);

  test("test_clarify_aKindAlwaysSkippedIsNamed", () => {
    const s = makeSubject();
    for (const id of ["two-sum", "dedupe", "kth-largest", "task-order"]) {
      recordClarify(s, id, allBut(id, "duplicates"), TODAY);
    }
    const blind = blindKinds(s).map((b) => b.kind);
    assert.ok(blind.includes("duplicates"), `got ${blind.join(", ")}`);
  });

  test("test_clarify_aKindAlwaysAskedIsNot", () => {
    const s = makeSubject();
    for (const id of ["two-sum", "dedupe", "kth-largest", "task-order"]) {
      recordClarify(s, id, promptById(id).questions.map((_, i) => i), TODAY);
    }
    assert.deepEqual(blindKinds(s), []);
  });

  test("test_clarify_oneMissIsNotAHabit", () => {
    // Fewer than HABIT_MIN chances is not enough to call it one.
    const s = makeSubject();
    recordClarify(s, "two-sum", allBut("two-sum", "duplicates"), TODAY);
    assert.ok(dupeIndex("two-sum") >= 0);
    assert.ok(!blindKinds(s).some((b) => b.kind === "duplicates"));
    assert.ok(HABIT_MIN > 1);
  });

  test("test_clarify_statsCoverEveryKindEvenUnplayed", () => {
    const stats = clarifyStats(makeSubject());
    assert.equal(stats.length, Object.keys(CLARIFY_KINDS).length);
    assert.ok(stats.every((s) => s.rate === null));
  });

  test("test_clarify_aRoundForARemovedPromptIsIgnored", () => {
    // Content changes; an old log entry must not throw or skew the tally.
    const stats = clarifyStats(makeSubject([{ id: "gone", date: TODAY, asked: [0] }]));
    assert.ok(stats.every((s) => s.of === 0));
  });
});
