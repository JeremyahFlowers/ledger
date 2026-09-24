// Where a problem statement came from.
//
// Two problems, one of which was a silent data bug. A statement fetched from
// the LeetCode sync was assigned straight onto the problem object — which is
// the same object that lives in state — so it changed the app's data without
// going through mutate. Never cached, never synced, gone when the tab closed,
// and re-fetched on the next session. It looked like it worked.
//
// The other: nothing recorded where a statement came from or when. A statement
// synced against the wrong problem looks exactly like a right one until you
// read it, and there was then no way to fetch it again — only to retype it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../js/session-view.js", import.meta.url)), "utf8");

describe("a fetched statement is stored properly", () => {
  test("test_statement_fetchedOne_goesThroughTheStore", () => {
    // `problem.statement = fetched` was the bug, in one line.
    const fetchBlock = src.slice(src.indexOf("store.fetchStatement(slug)"), src.indexOf("// Only this pane"));
    assert.match(fetchBlock, /saveStatement\(/);
    assert.doesNotMatch(fetchBlock, /problem\.statement\s*=\s*fetched/);
  });

  test("test_statement_saveHelper_mutatesThroughTheStore", () => {
    const fn = src.slice(src.indexOf("function saveStatement("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    assert.match(body, /store\.mutate\(/);
  });

  test("test_statement_saveHelper_keepsTheInSessionCopyInStep", () => {
    // The pane repaints from the in-session object, so it has to match what
    // was just written or the save appears to have done nothing.
    const fn = src.slice(src.indexOf("function saveStatement("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    assert.match(body, /problem\.statement = text/);
    assert.match(body, /problem\.statementMeta = meta/);
  });

  test("test_statement_bothSourcesRecordWhereItCameFrom", () => {
    assert.match(src, /saveStatement\(store, problem, fetched, "leetcode"\)/);
    assert.match(src, /saveStatement\(store, problem, text, "pasted"\)/);
  });
});

describe("what the pane says about it", () => {
  test("test_statement_namesBothSources", () => {
    assert.match(src, /leetcode: "fetched from LeetCode"/);
    assert.match(src, /pasted: "pasted by you"/);
  });

  test("test_statement_olderOnesSayTheSourceIsUnknown", () => {
    // Statements saved before this shipped have no provenance. Guessing
    // "pasted" because that used to be the only way would be a plausible lie.
    assert.match(src, /source not recorded/);
  });

  test("test_statement_canBeReplacedNotOnlyEdited", () => {
    // Edit keeps the text, for a typo. Replace clears it and offers the fetch
    // again, which is the only way back from a wrong statement.
    assert.match(src, /ws-replace-statement/);
    assert.match(src, /openEditor\(\{ keepText: false \}\)/);
    assert.match(src, /openEditor\(\{ keepText: true \}\)/);
  });

  test("test_statement_replaceOffersTheFetchAgain", () => {
    const fn = src.slice(src.indexOf("const openEditor ="));
    assert.match(fn.slice(0, 900), /ws-fetch-statement/);
  });
});
