// Module-lifecycle tests for js/catalog.js: how it behaves when the network
// fails, and whether a failure poisons the memoized promise.
//
// These use loadCatalog({ refresh: true }) rather than cache-busted dynamic
// imports. That isn't only tidier — V8 merges coverage by file path, so a
// re-imported instance silently overwrote the real coverage for the whole file
// and reported thoroughly tested functions as dead code.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { loadCatalog, CatalogError } from "../js/catalog.js";

function stubFetch(payload, { ok = true, status = 200 } = {}) {
  globalThis.fetch = async () => ({ ok, status, json: async () => payload });
}

const EMPTY = { count: 0, problems: [] };

describe("loadCatalog", () => {
  test("test_loadCatalog_httpError_throwsTypedCatalogErrorWithStatus", async () => {
    stubFetch(null, { ok: false, status: 404 });
    await assert.rejects(loadCatalog({ refresh: true }),
      (e) => e instanceof CatalogError && e.status === 404);
  });

  test("test_loadCatalog_networkFailure_wrapsTheCauseInATypedError", async () => {
    globalThis.fetch = async () => { throw new TypeError("offline"); };
    await assert.rejects(loadCatalog({ refresh: true }),
      (e) => e instanceof CatalogError && e.cause instanceof TypeError);
  });

  test("test_loadCatalog_errorMessage_isSafeToShowAUser", async () => {
    // Internal details belong on the cause, not in the sentence on screen.
    stubFetch(null, { ok: false, status: 500 });
    await assert.rejects(loadCatalog({ refresh: true }), (e) => {
      assert.ok(!/HTTP|fetch|undefined|\[object/.test(e.message), `leaky message: ${e.message}`);
      return true;
    });
  });

  test("test_loadCatalog_failureThenSuccess_retriesRatherThanCachingTheError", async () => {
    // One flaky request must not disable the catalog for the rest of the
    // session, so a rejected promise is never left memoized.
    globalThis.fetch = async () => { throw new TypeError("offline"); };
    await assert.rejects(loadCatalog({ refresh: true }));
    stubFetch(EMPTY);
    assert.deepEqual((await loadCatalog()).problems, []);
  });

  test("test_loadCatalog_repeatedCalls_fetchOnlyOnce", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => EMPTY }; };
    await loadCatalog({ refresh: true });
    await loadCatalog();
    await loadCatalog();
    assert.equal(calls, 1, "a ~1 MB catalog must not be refetched on every view render");
  });

  test("test_loadCatalog_refresh_picksUpARebuiltCatalog", async () => {
    stubFetch({ count: 1, problems: [{ slug: "old", title: "Old", patterns: {} }] });
    await loadCatalog({ refresh: true });
    stubFetch({ count: 1, problems: [{ slug: "new", title: "New", patterns: {} }] });
    const after = await loadCatalog({ refresh: true });
    assert.equal(after.problems[0].slug, "new");
  });
});
