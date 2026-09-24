// What happens to work that never reached GitHub.
//
// The scenario this app exists for: a phone on a train with no signal. You
// work a problem, the save fails, the work goes to localStorage, you close the
// tab. Later, at home, you open it again.
//
// init() then fetches the remote copy, adopts it, and calls _cacheLocally(),
// which overwrites the cache. The cached state is read only in the catch
// branch — so if the fetch succeeds, an hour of work is discarded without a
// word. `dirty` lives in memory and does not survive the reload, so nothing
// even knows there was anything to keep.
//
// These tests were written to fail first, against exactly that.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
  clear: () => memory.clear(),
};

const { store } = await import("../js/store.js");
const { GitHubStore } = await import("../js/github-client.js");

// init() builds its own GitHubStore from the saved config, so the only way to
// control what "GitHub" answers is to replace the methods on the prototype.
let remoteState = null;
let saved = [];
GitHubStore.prototype.fetchState = async () => ({ exists: remoteState !== null, state: remoteState });
GitHubStore.prototype.saveState = async (state) => { saved.push(state); };
GitHubStore.prototype.fetchPublicFile = async () => null;

const CACHE_KEY = "ledger.cache.state";
const CONFIG_KEY = "ledger.config";
const PENDING_KEY = "ledger.cache.unsynced";

/** The browser as an offline session left it: a cached copy, and the flag
 *  saying it holds changes GitHub has never seen. */
function closedWithUnsavedWork(state) {
  memory.set(CACHE_KEY, JSON.stringify(state));
  memory.set(PENDING_KEY, "1");
}

/** The browser as a clean exit left it: a cache that matches the remote. */
function closedCleanly(state) {
  memory.set(CACHE_KEY, JSON.stringify(state));
  memory.set(PENDING_KEY, "");
}

/** A state with one journal entry, so "did this survive" has an answer. */
function stateWith(note, over = {}) {
  return {
    meta: { schemaVersion: 4, appVersion: "test" },
    settings: {
      dailyBudgetMin: 75, boxIntervalsDays: [0, 1, 3, 7, 16, 35],
      estimateMinByDifficulty: { Easy: 20, Medium: 30, Hard: 45, Unrated: 30 },
      systemDesignUnlockThreshold: { minMocks: 10, minSolvedCleanRate: 0.7 },
    },
    patterns: [], problems: [], mocks: [],
    journal: note ? [{ id: "j1", date: "2026-09-20", type: "note", text: note }] : [],
    systemDesign: { manualUnlock: false, sessions: [] },
    streak: { current: 0, longest: 0, lastActiveDate: null },
    resources: {}, whiteboards: [],
    quiz: { totalAsked: 0, totalCorrect: 0, recent: [] },
    ...over,
  };
}

const notes = () => (store.state.journal || []).map((j) => j.text);

describe("reopening with work that never synced", () => {
  beforeEach(() => {
    memory.clear();
    memory.set(CONFIG_KEY, JSON.stringify({ owner: "o", repo: "r", branch: "main", path: "p", token: "t" }));
    store.state = null;
    store.dirty = false;
    store.status = "unconfigured";
    store.lastSyncedAt = null;
    store._cancelRetry();
    remoteState = stateWith(null);
    saved = [];
  });

  test("test_init_cachedWorkThatNeverSynced_isNotSilentlyDiscarded", async () => {
    // The whole bug, in one case: the cache holds an entry the remote has
    // never seen, the fetch succeeds, and the entry must still be there.
    closedWithUnsavedWork(stateWith("written on the train"));
    await store.init();
    assert.ok(notes().includes("written on the train"),
      "an hour of offline work was thrown away by opening the app");
  });

  test("test_init_cachedWorkThatNeverSynced_isPushedNotJustRestored", async () => {
    // Surviving in memory is not enough. If it isn't sent, the next reopen
    // finds a clean cache and loses it for real.
    closedWithUnsavedWork(stateWith("written on the train"));
    await store.init();
    assert.ok(saved.some((st) => st.journal.some((j) => j.text === "written on the train")),
      "the recovered work was never sent to GitHub");
  });

  test("test_init_recoveryIsAnnounced", async () => {
    // A silent save is indistinguishable from nothing having been at stake,
    // and the user has no other way to learn their offline hour was rescued.
    closedWithUnsavedWork(stateWith("written on the train"));
    await store.init();
    assert.equal(store.recovered, true);
  });

  test("test_init_bothSidesHaveWork_goesToTheConflictScreen", async () => {
    // Neither copy can be chosen for the user here: both hold attempts the
    // other has never seen. The conflict screen exists to show what each
    // choice would discard.
    const attempt = (id, date) => ({
      id, date, outcome: "solved-clean", patternGuess: "correct",
      timeToInsightMin: 5, timeToSolveMin: 20, mistakeTags: [], soulStatement: "",
    });
    const withAttempt = (id) => stateWith(null, {
      problems: [{ id: "p", name: "P", number: 1, difficulty: "Medium", patternId: "x",
        status: "active", box: 0, nextReviewDate: "2026-09-24", attempts: [attempt(id, "2026-09-20")] }],
    });
    closedWithUnsavedWork(withAttempt("local-only"));
    remoteState = withAttempt("remote-only");
    await store.init();
    assert.equal(store.status, "conflict");
    assert.equal(saved.length, 0, "nothing may be pushed before the user chooses");
  });

  test("test_init_localStrictlyAhead_doesNotAskTheUserAnything", async () => {
    // The common case — one device, worked offline. There is nothing to
    // decide, so deciding is not offered.
    closedWithUnsavedWork(stateWith("written on the train"));
    await store.init();
    assert.notEqual(store.status, "conflict");
  });

  test("test_init_cacheThatMatchesTheRemote_isNotTreatedAsUnsynced", async () => {
    // The normal case, and it must stay quiet: nothing was lost, nothing is
    // pending, and the app is plainly synced.
    const same = stateWith("already on github");
    closedCleanly(same);
    remoteState = JSON.parse(JSON.stringify(same));
    await store.init();
    assert.equal(store.dirty, false);
  });

  test("test_init_noCacheAtAll_justTakesTheRemote", async () => {
    memory.delete(CACHE_KEY);
    await store.init();
    assert.ok(Array.isArray(store.state.journal));
  });
});
