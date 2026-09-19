// Tests for the store's notification contract.
//
// These exist because of a real bug. renderReflect recorded the pattern-recall
// answer with store.mutate, mutate notifies listeners, the listener re-renders
// the whole view, and the view's markup hardcoded the Save button as disabled
// instead of deriving it from state — so answering wiped the answer, and an
// early-return guard then refused every retry. The core loop could not be
// completed at all, and it shipped.
//
// The lesson isn't about that one view: any view calling mutate while the user
// is mid-form has to survive being rebuilt. Pinning that mutate really does
// notify is what makes that requirement visible rather than folklore.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// store.js reads localStorage when the module initializes.
const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
  clear: () => memory.clear(),
};

const { store } = await import("../js/store.js");

function seedState() {
  store.state = {
    meta: { schemaVersion: 4 },
    settings: { dailyBudgetMin: 75 },
    patterns: [], problems: [], mocks: [], journal: [],
    systemDesign: { manualUnlock: false, sessions: [] },
    streak: { current: 0, longest: 0, lastActiveDate: null },
    resources: {}, whiteboards: [],
    quiz: { totalAsked: 0, totalCorrect: 0, recent: [] },
  };
}

describe("store.mutate", () => {
  beforeEach(() => {
    memory.clear();
    seedState();
    store.gh = null;
    clearTimeout(store.saveTimer);
  });

  test("test_mutate_notifiesEveryListener", () => {
    // This is the mechanism that re-renders the active view mid-interaction.
    let calls = 0;
    const off = store.onChange(() => { calls++; });
    store.mutate((s) => { s.quiz.totalAsked += 1; }, "test");
    off();
    assert.equal(calls, 1);
  });

  test("test_mutate_appliesTheChangeBeforeNotifying", () => {
    // A listener that re-renders must see the new value, not the old one.
    let seen = null;
    const off = store.onChange(() => { seen = store.state.quiz.totalAsked; });
    store.mutate((s) => { s.quiz.totalAsked = 7; }, "test");
    off();
    assert.equal(seen, 7);
  });

  test("test_mutate_cachesLocallySoAReloadKeepsTheChange", () => {
    store.mutate((s) => { s.quiz.totalCorrect = 3; }, "test");
    const cached = JSON.parse(memory.get("ledger.cache.state"));
    assert.equal(cached.quiz.totalCorrect, 3);
  });

  test("test_mutate_marksStateDirtyForTheNextFlush", () => {
    store.dirty = false;
    store.mutate((s) => { s.quiz.totalAsked += 1; }, "test");
    assert.equal(store.dirty, true);
  });

  test("test_onChange_returnsAnUnsubscribe", () => {
    let calls = 0;
    const off = store.onChange(() => { calls++; });
    off();
    store.mutate((s) => { s.quiz.totalAsked += 1; }, "test");
    assert.equal(calls, 0, "a detached view must stop being notified");
  });

  test("test_mutate_severalListeners_allFire", () => {
    let a = 0, b = 0;
    const offA = store.onChange(() => { a++; });
    const offB = store.onChange(() => { b++; });
    store.mutate((s) => { s.quiz.totalAsked += 1; }, "test");
    offA(); offB();
    assert.equal(a, 1);
    assert.equal(b, 1);
  });
});
