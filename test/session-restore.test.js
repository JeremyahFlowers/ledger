// Opening the app on a session that isn't there (js/session-view.js).
//
// The active tab is remembered across reloads; the in-memory session is not
// always restored with it. Exit a session in a way that leaves the tab set to
// `workspace` — or reload while the store is still recovering — and the next
// load renders a workspace with no session behind it.
//
// renderWorkspace had a guard for exactly this. It sat three lines below the
// first two statements that dereference `session`, so it never ran: the reload
// threw "Cannot read properties of null (reading 'sync')" and the error
// boundary took the whole page, on an app whose state was perfectly fine.
//
// These call the render with no session, which is the only state that matters
// here — a correct guard returns before anything else happens, so there is
// nothing to stub.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderWorkspace, renderReflect, hasActiveSession } from "../js/session-view.js";

/** A render's collaborators, recording where it tried to send the user. */
function makeSubject() {
  const switched = [];
  return {
    root: null,
    store: { state: null },
    actions: { switchTab: (tab) => switched.push(tab) },
    switched,
  };
}

describe("a workspace with no session behind it", () => {
  test("test_renderWorkspace_noSession_doesNotThrow", () => {
    const s = makeSubject();
    assert.doesNotThrow(() => renderWorkspace(s.root, s.store, s.actions),
      "the guard is below the code it exists to guard");
  });

  test("test_renderWorkspace_noSession_sendsTheUserSomewhereReal", () => {
    const s = makeSubject();
    renderWorkspace(s.root, s.store, s.actions);
    assert.deepEqual(s.switched, ["dashboard"]);
  });

  test("test_renderWorkspace_noSession_doesNotTouchTheRoot", () => {
    // Nothing should be written: the view it would write is the one that
    // cannot be built. Passing null for the root proves it never tried.
    const s = makeSubject();
    renderWorkspace(null, s.store, s.actions);
    assert.equal(s.switched.length, 1);
  });
});

describe("the other views that need a session", () => {
  test("test_renderReflect_noSession_alsoLeavesRatherThanThrows", () => {
    const s = makeSubject();
    assert.doesNotThrow(() => renderReflect(s.root, s.store, s.actions));
    assert.deepEqual(s.switched, ["dashboard"]);
  });
});

describe("what the app asks before it renders either", () => {
  test("test_hasActiveSession_withNoSession_isFalse", () => {
    assert.equal(hasActiveSession(), false);
  });
});
