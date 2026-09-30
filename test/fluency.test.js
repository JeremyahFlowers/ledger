// Your language, until the syntax takes no thought (js/fluency.js).
//
// Whether each answer is *correct* is checked by running it — see
// scripts/check-fluency.mjs, which compiles all of them in all four languages.
// These pin everything else: that every card is complete, that the drill
// reaches for the right card next, and that a grade is recorded per language.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  LANGUAGES, FLUENCY_CARDS, GRADES,
  cardById, pickFluencyCard, recordFluency, fluencySummary,
} from "../js/fluency.js";
import { CODE_MODES } from "../js/codemirror-loader.js";

const TODAY = "2026-09-29";
const makeSubject = (fluency = {}) => ({ fluency: { ...fluency } });

describe("the bank", () => {
  test("test_fluency_everyEditorLanguageIsDrillable", () => {
    // If the editor offers a language the drill cannot teach, choosing it
    // as "your language" leads nowhere.
    assert.deepEqual(Object.keys(LANGUAGES).sort(), Object.keys(CODE_MODES).sort());
  });

  test("test_fluency_everyCardAnswersInEveryLanguage", () => {
    for (const card of FLUENCY_CARDS) {
      for (const lang of Object.keys(LANGUAGES)) {
        assert.ok(card.answers[lang]?.trim(), `${card.id} has no ${lang} answer`);
      }
    }
  });

  test("test_fluency_idsAreUnique", () => {
    const ids = FLUENCY_CARDS.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("test_fluency_everyCardSaysWhatToWrite", () => {
    for (const card of FLUENCY_CARDS) {
      assert.ok(card.prompt.length > 20, `${card.id} has a thin prompt`);
      assert.ok(card.topic, `${card.id} has no topic`);
    }
  });

  test("test_fluency_everyCardNamesAtLeastOneTrap", () => {
    // The pitfall is the point. Most people can write these; the drill is for
    // writing them correctly at speed.
    for (const card of FLUENCY_CARDS) {
      const traps = Object.values(card.pitfalls || {});
      assert.ok(traps.length, `${card.id} names no pitfall`);
      for (const t of traps) assert.ok(t.length > 30, `${card.id} has a thin pitfall`);
    }
  });

  test("test_fluency_pitfallsOnlyNameRealLanguages", () => {
    for (const card of FLUENCY_CARDS) {
      for (const lang of Object.keys(card.pitfalls || {})) {
        assert.ok(LANGUAGES[lang], `${card.id} has a pitfall for "${lang}"`);
      }
    }
  });

  test("test_fluency_theBankIsBigEnoughToBeADrill", () => {
    assert.ok(FLUENCY_CARDS.length >= 12);
  });

  test("test_fluency_cardById_unknownIsNull", () => {
    assert.equal(cardById("nonsense"), null);
  });
});

describe("which card comes next", () => {
  test("test_fluency_aFreshStartPicksSomething", () => {
    assert.ok(pickFluencyCard(makeSubject(), "python", [], TODAY));
  });

  test("test_fluency_neverSeenBeatsEverythingSeen", () => {
    // A gap you do not know about is the worst kind.
    const seenAll = Object.fromEntries(FLUENCY_CARDS.slice(1).map((c) =>
      [`python:${c.id}`, { grade: "missed", at: TODAY, n: 1, misses: 1 }]));
    const next = pickFluencyCard(makeSubject(seenAll), "python", [], TODAY);
    assert.equal(next.id, FLUENCY_CARDS[0].id);
  });

  test("test_fluency_aMissComesBackBeforeSomethingFluent", () => {
    const log = Object.fromEntries(FLUENCY_CARDS.map((c) =>
      [`java:${c.id}`, { grade: "instant", at: "2026-09-01", n: 1, misses: 0 }]));
    log["java:grid"] = { grade: "missed", at: TODAY, n: 1, misses: 1 };
    assert.equal(pickFluencyCard(makeSubject(log), "java", [], TODAY).id, "grid");
  });

  test("test_fluency_theJustAskedAreHeldBack", () => {
    // Asking a wrong answer again immediately tests whether you can read,
    // not whether you know.
    const log = { "cpp:grid": { grade: "missed", at: TODAY, n: 1, misses: 1 } };
    const next = pickFluencyCard(makeSubject(log), "cpp", ["grid"], TODAY);
    assert.notEqual(next.id, "grid");
  });

  test("test_fluency_ifEverythingIsHeldBackItStillPicks", () => {
    const all = FLUENCY_CARDS.map((c) => c.id);
    assert.ok(pickFluencyCard(makeSubject(), "python", all, TODAY));
  });

  test("test_fluency_progressIsPerLanguage", () => {
    // Fluent in Python says nothing about Java.
    const log = Object.fromEntries(FLUENCY_CARDS.map((c) =>
      [`python:${c.id}`, { grade: "instant", at: TODAY, n: 1, misses: 0 }]));
    assert.equal(fluencySummary(makeSubject(log), "python").fluent, FLUENCY_CARDS.length);
    assert.equal(fluencySummary(makeSubject(log), "java").seen, 0);
  });

  test("test_fluency_somethingFluentWaitsAWhileBeforeReturning", () => {
    const log = Object.fromEntries(FLUENCY_CARDS.map((c) =>
      [`python:${c.id}`, { grade: "instant", at: TODAY, n: 1, misses: 0 }]));
    log["python:grid"] = { grade: "slow", at: "2026-09-20", n: 1, misses: 0 };
    // Everything fluent was seen today; the one that was slow nine days ago is due.
    assert.equal(pickFluencyCard(makeSubject(log), "python", [], TODAY).id, "grid");
  });
});

describe("recording a grade", () => {
  test("test_fluency_recordFluency_countsAttemptsAndMisses", () => {
    const s = makeSubject();
    recordFluency(s, "python", "grid", "missed", TODAY);
    recordFluency(s, "python", "grid", "instant", TODAY);
    assert.deepEqual(s.fluency["python:grid"], { grade: "instant", at: TODAY, n: 2, misses: 1 });
  });

  test("test_fluency_recordFluency_ignoresAnUnknownGrade", () => {
    const s = makeSubject();
    recordFluency(s, "python", "grid", "brilliant", TODAY);
    assert.deepEqual(s.fluency, {});
  });

  test("test_fluency_recordFluency_ignoresAnUnknownCardOrLanguage", () => {
    const s = makeSubject();
    recordFluency(s, "python", "nonsense", "instant", TODAY);
    recordFluency(s, "cobol", "grid", "instant", TODAY);
    assert.deepEqual(s.fluency, {});
  });

  test("test_fluency_everyGradeIsLabelled", () => {
    for (const g of Object.values(GRADES)) assert.ok(g.label);
  });

  test("test_fluency_summaryOfNothing", () => {
    const sum = fluencySummary({}, "python");
    assert.deepEqual({ seen: sum.seen, fluent: sum.fluent }, { seen: 0, fluent: 0 });
    assert.equal(sum.total, FLUENCY_CARDS.length);
  });
});
