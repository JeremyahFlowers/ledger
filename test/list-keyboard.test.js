// Arrow-key movement through a list of rows (js/chrome.js).
//
// This behaviour existed, once, privately inside the problem bank — written
// because the filters above the list were reachable from the keyboard and the
// 2,500 rows below them were not, which is the wrong way round. Then it stayed
// there, so the refresher queue, today's plan and a topic's practice ladder
// remained mouse-only while the one list that worked kept its own copy.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { wireListRows } from "../js/chrome.js";

/** The smallest DOM this needs: rows that can hold focus and a list that can
 *  receive a bubbled keydown. */
function makeList(count, { withButton = true } = {}) {
  const focused = { row: null };
  const clicked = [];
  const listeners = [];

  const rows = Array.from({ length: count }, (_, i) => {
    const button = { click: () => clicked.push(i) };
    const row = {
      tabIndex: -1, dataset: {},
      focus() { focused.row = i; },
      querySelector: () => (withButton ? button : null),
    };
    row.closest = (sel) => (sel === ".queue-item" ? row : null);
    return row;
  });

  const list = {
    querySelectorAll: () => rows,
    addEventListener: (type, fn) => listeners.push([type, fn]),
  };

  const press = (key, rowIndex, { onRowItself = true } = {}) => {
    const row = rows[rowIndex];
    const target = onRowItself ? row : { closest: row.closest };
    let defaultPrevented = false;
    for (const [type, fn] of listeners) {
      if (type !== "keydown") continue;
      fn({ key, target, preventDefault: () => { defaultPrevented = true; } });
    }
    return defaultPrevented;
  };

  return { list, rows, focused, clicked, press };
}

describe("moving", () => {
  let l;
  beforeEach(() => { l = makeList(4); wireListRows(l.list); });

  test("test_listKeyboard_arrowDown_movesToTheNextRow", () => {
    l.press("ArrowDown", 0);
    assert.equal(l.focused.row, 1);
  });

  test("test_listKeyboard_arrowUp_movesToThePreviousRow", () => {
    l.press("ArrowUp", 2);
    assert.equal(l.focused.row, 1);
  });

  test("test_listKeyboard_atTheBottom_staysThere", () => {
    // Wrapping to the top from the last row loses your place silently.
    l.press("ArrowDown", 3);
    assert.equal(l.focused.row, null, "focus moved off the end of the list");
  });

  test("test_listKeyboard_atTheTop_staysThere", () => {
    l.press("ArrowUp", 0);
    assert.equal(l.focused.row, null);
  });

  test("test_listKeyboard_homeAndEnd_jump", () => {
    // The long list is the reason this exists; reaching the end of one should
    // not mean holding a key down.
    l.press("End", 0);
    assert.equal(l.focused.row, 3);
    l.press("Home", 3);
    assert.equal(l.focused.row, 0);
  });

  test("test_listKeyboard_arrowKeysDoNotAlsoScrollThePage", () => {
    assert.equal(l.press("ArrowDown", 0), true, "preventDefault was not called");
  });

  test("test_listKeyboard_rowsAreMadeFocusable", () => {
    // Without this nothing can receive the keydown in the first place.
    assert.deepEqual(l.rows.map((r) => r.tabIndex), [0, 0, 0, 0]);
  });

  test("test_listKeyboard_rowsAreIndexedInOrder", () => {
    assert.deepEqual(l.rows.map((r) => r.dataset.rowIndex), ["0", "1", "2", "3"]);
  });
});

describe("acting on a row", () => {
  test("test_listKeyboard_enter_clicksTheRowsPrimaryControl", () => {
    const l = makeList(3);
    wireListRows(l.list);
    l.press("Enter", 1);
    assert.deepEqual(l.clicked, [1]);
  });

  test("test_listKeyboard_enterInsideARow_isLeftToTheButton", () => {
    // Inside a row the buttons are real buttons and Enter is already theirs;
    // handling it again would fire two actions from one keypress.
    const l = makeList(3);
    wireListRows(l.list);
    l.press("Enter", 1, { onRowItself: false });
    assert.deepEqual(l.clicked, []);
  });

  test("test_listKeyboard_onActivate_overridesTheDefault", () => {
    // The bank needs this: a catalog problem has to be saved into your list
    // before a session can be logged against it.
    const l = makeList(3);
    const activated = [];
    wireListRows(l.list, { onActivate: (row, i) => activated.push(i) });
    l.press("Enter", 2);
    assert.deepEqual(activated, [2]);
    assert.deepEqual(l.clicked, [], "the default ran as well as the override");
  });

  test("test_listKeyboard_rowWithNoControls_doesNotThrow", () => {
    const l = makeList(2, { withButton: false });
    wireListRows(l.list);
    assert.doesNotThrow(() => l.press("Enter", 0));
  });
});

describe("lists that aren't there", () => {
  test("test_listKeyboard_noList_doesNothing", () => {
    assert.doesNotThrow(() => wireListRows(null));
  });

  test("test_listKeyboard_emptyList_bindsNothing", () => {
    // An empty list is every list's first state, on every page.
    const bound = [];
    const list = { querySelectorAll: () => [], addEventListener: (t) => bound.push(t) };
    wireListRows(list);
    assert.deepEqual(bound, []);
  });
});
