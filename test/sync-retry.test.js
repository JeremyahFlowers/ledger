// Tests for retrying a failed save (js/store.js).
//
// A save that failed left the work in localStorage and the status at
// "offline" until the next mutation happened to trigger a flush. Close the tab
// in between and the only copy of that session was on that device.
//
// These exercise the store against a fake GitHub rather than the network, so
// they are deterministic and fast. Timers are driven by hand for the same
// reason — a test that waits five real seconds for a backoff is a test nobody
// runs.

import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

// The store reaches for localStorage at import time.
globalThis.localStorage = {
  _v: new Map(),
  getItem(k) { return this._v.has(k) ? this._v.get(k) : null; },
  setItem(k, v) { this._v.set(k, String(v)); },
  removeItem(k) { this._v.delete(k); },
};

const { store } = await import("../js/store.js");

/** A stand-in for GitHubStore that fails on demand and counts attempts. */
function fakeGitHub({ failWith = null, failTimes = Infinity } = {}) {
  return {
    saves: 0,
    async saveState() {
      this.saves += 1;
      if (failWith && this.saves <= failTimes) {
        const err = new Error(failWith.message || "boom");
        if (failWith.code) err.code = failWith.code;
        throw err;
      }
      return { content: { sha: "sha" } };
    },
  };
}

function prepare(gh) {
  store.gh = gh;
  store.state = { meta: {}, settings: { dailyBudgetMin: 75 }, patterns: [], problems: [], mocks: [], journal: [] };
  store.dirty = true;
  store.status = "synced";
  store.error = null;
  store._cancelRetry();
  return gh;
}

describe("flush retries", () => {
  test("test_flush_transientFailure_schedulesAnotherAttempt", async () => {
    const gh = prepare(fakeGitHub({ failWith: { message: "network down" } }));
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      await store.flush("x");
      assert.equal(gh.saves, 1);
      assert.equal(store.status, "offline");
      assert.ok(store.retryTimer, "a failed save must not simply give up");
    } finally {
      store._cancelRetry();
      mock.timers.reset();
    }
  });

  test("test_flush_conflict_doesNotRetry", async () => {
    // Another attempt produces the same conflict. This one needs the user.
    const gh = prepare(fakeGitHub({ failWith: { code: "conflict", message: "conflict" } }));
    await store.flush("x");
    assert.equal(store.status, "conflict");
    assert.equal(store.retryTimer, null, "retrying a conflict just repeats it");
    store._cancelRetry();
  });

  test("test_flush_success_clearsAnyPendingRetry", async () => {
    const gh = prepare(fakeGitHub({ failWith: { message: "down" }, failTimes: 1 }));
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      await store.flush("x");
      assert.ok(store.retryTimer);
      store.dirty = true;
      await store.flush("x");
      assert.equal(store.status, "synced");
      assert.equal(store.retryTimer, null);
      assert.equal(store.retryAttempt, 0, "the backoff must reset once it works");
    } finally {
      store._cancelRetry();
      mock.timers.reset();
    }
  });

  test("test_flush_backoffGivesUpRatherThanRetryingForever", async () => {
    // A failure that survives four minutes is not going to be fixed by a
    // fifth attempt, and a request every few seconds for an hour is its own
    // problem.
    const gh = prepare(fakeGitHub({ failWith: { message: "down" } }));
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      for (let i = 0; i < 8; i++) {
        store.dirty = true;
        await store.flush("x");        // deliberately not cancelling between
      }
      assert.equal(store.retryTimer, null, "the schedule must run out");
      assert.ok(gh.saves >= 5, `kept trying for a while first (${gh.saves})`);
    } finally {
      store._cancelRetry();
      mock.timers.reset();
    }
  });

  test("test_flush_aLogOverTheLimit_isNotRetried", async () => {
    // No number of attempts makes the file smaller.
    const gh = prepare(fakeGitHub());
    store.state.problems = [{ id: "p", name: "x", attempts: [], statement: "z".repeat(1100 * 1024) }];
    await store.flush("x");
    assert.equal(store.status, "error");
    assert.equal(gh.saves, 0, "it should never have been sent");
    assert.equal(store.retryTimer, null);
  });
});

describe("retryNow", () => {
  test("test_retryNow_resetsTheBackoffAndTriesImmediately", async () => {
    const gh = prepare(fakeGitHub({ failWith: { message: "down" }, failTimes: 1 }));
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      await store.flush("x");
      assert.equal(gh.saves, 1);
      store.retryNow("y");
      await new Promise((r) => setImmediate(r));
      assert.equal(gh.saves, 2, "coming back online is new information, not another failure");
    } finally {
      store._cancelRetry();
      mock.timers.reset();
    }
  });

  test("test_retryNow_withNothingPending_doesNothing", async () => {
    const gh = prepare(fakeGitHub());
    store.dirty = false;
    store.retryNow();
    await new Promise((r) => setImmediate(r));
    assert.equal(gh.saves, 0);
  });
});
