// The sync path checks what it loads.
//
// inspectImport had guarded the import path since it was written: pick a file
// that isn't a Ledger log and it refuses, by name, with what's wrong. The sync
// path — the one that runs every single time the app opens — trusted whatever
// came back. migrateState only backfills missing keys, so a truncated write, a
// hand edit or a bad merge went straight into the views and the first thing
// the user saw was a blank page with one line in a console nobody is watching.
//
// Two paths load the same document and only the rarer one checked it.

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

let remoteState = null;
let saved = [];
GitHubStore.prototype.fetchState = async () => ({ exists: remoteState !== null, state: remoteState });
GitHubStore.prototype.saveState = async (state) => { saved.push(state); };
GitHubStore.prototype.fetchPublicFile = async () => null;

const CACHE_KEY = "ledger.cache.state";
const CONFIG_KEY = "ledger.config";

function goodState(over = {}) {
  return {
    meta: { schemaVersion: 4 },
    settings: { dailyBudgetMin: 75, boxIntervalsDays: [0, 1, 3, 7, 16, 35],
      estimateMinByDifficulty: { Medium: 30 },
      systemDesignUnlockThreshold: { minMocks: 10, minSolvedCleanRate: 0.7 } },
    patterns: [], problems: [], mocks: [], journal: [],
    systemDesign: { manualUnlock: false, sessions: [] },
    streak: { current: 0, longest: 0, lastActiveDate: null },
    resources: {}, whiteboards: [],
    quiz: { totalAsked: 0, totalCorrect: 0, recent: [] },
    ...over,
  };
}

describe("a remote file that can't be read", () => {
  beforeEach(() => {
    memory.clear();
    memory.set(CONFIG_KEY, JSON.stringify({ owner: "o", repo: "r", branch: "main", path: "prep-data/state.json", token: "t" }));
    store.state = null;
    store.dirty = false;
    store.blocked = false;
    store.status = "unconfigured";
    store._cancelRetry();
    saved = [];
    remoteState = goodState();
  });

  const bad = [
    ["not an object at all", "just a string"],
    ["an array", []],
    ["missing its problems list", goodState({ problems: undefined })],
    ["a problem with no id", goodState({ problems: [{ name: "P" }] })],
    ["an unreadable attempt history", goodState({ problems: [{ id: "p", name: "P", attempts: "oops" }] })],
  ];

  for (const [description, value] of bad) {
    test(`test_init_remoteIs_${description.replace(/\W+/g, "_")}_isRefused`, async () => {
      remoteState = value;
      memory.set(CACHE_KEY, JSON.stringify(goodState()));
      await store.init();
      assert.equal(store.status, "error", `${description} was accepted`);
    });
  }

  test("test_init_unreadableRemote_saysWhereToLook", async () => {
    // "Something went wrong" is not actionable. The file has a path, and the
    // user can open it.
    remoteState = "nonsense";
    await store.init();
    assert.match(store.error, /prep-data\/state\.json/);
    assert.match(store.error, /Nothing here has been changed/);
  });

  test("test_init_unreadableRemote_stillShowsYourCachedWork", async () => {
    // Refusing the file is not a reason to show nothing.
    memory.set(CACHE_KEY, JSON.stringify(goodState({ journal: [{ id: "j", date: "2026-09-01", type: "note", text: "kept" }] })));
    remoteState = "nonsense";
    await store.init();
    assert.ok(store.state.journal.some((j) => j.text === "kept"));
  });

  test("test_flush_isRefusedWhileTheRemoteIsUnreadable", async () => {
    // The damaged file is the only evidence of what it held. Saving over it
    // destroys that, and "offline" would have done exactly that on the next
    // mutation.
    remoteState = "nonsense";
    await store.init();
    store.dirty = true;
    await store.flush("test");
    assert.deepEqual(saved, [], "saved over a file nobody has looked at yet");
  });

  test("test_init_unreadableRemote_isNotReportedAsOffline", async () => {
    // Offline means carry on, we'll save later. That is the opposite of what
    // should happen here.
    memory.set(CACHE_KEY, JSON.stringify(goodState()));
    remoteState = "nonsense";
    await store.init();
    assert.notEqual(store.status, "offline");
  });
});

describe("a remote file that is fine", () => {
  beforeEach(() => {
    memory.clear();
    memory.set(CONFIG_KEY, JSON.stringify({ owner: "o", repo: "r", branch: "main", path: "p", token: "t" }));
    store.state = null;
    store.dirty = false;
    store.blocked = false;
    store._cancelRetry();
    saved = [];
    remoteState = goodState();
  });

  test("test_init_validRemote_loadsNormally", async () => {
    await store.init();
    assert.equal(store.status, "synced");
    assert.equal(store.blocked, false);
  });

  test("test_init_anEmptyButValidLog_isNotMistakenForCorruption", async () => {
    // A brand new log has no problems, no attempts and no journal. That is
    // not the same as a broken file, and refusing it would lock out every
    // new account.
    remoteState = goodState();
    await store.init();
    assert.equal(store.status, "synced");
  });

  test("test_init_aGoodReadClearsAnEarlierBlock", async () => {
    remoteState = "nonsense";
    await store.init();
    assert.equal(store.blocked, true);
    remoteState = goodState();
    store.state = null;
    store.status = "unconfigured";
    await store.init();
    assert.equal(store.blocked, false);
  });
});
