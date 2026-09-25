// Where the cursor goes when you navigate.
//
// The app announced each new view into a live region and never moved focus
// there. After `g q` the cursor was still on the nav button that the re-render
// had just replaced, which drops focus to <body> — so the next Tab started
// from the top of the document, and every navigation cost a keyboard user a
// walk back through the header, the search box and both tiers of nav.
//
// `#view-root` has carried `tabindex="-1"` for exactly this since it was
// written, and was never focused.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = readFileSync(fileURLToPath(new URL("../js/app.js", import.meta.url)), "utf8");
const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
const fn = app.slice(app.indexOf("function moveFocusToView()"), app.indexOf("\n}", app.indexOf("function moveFocusToView()")));

describe("the target", () => {
  test("test_focus_viewRootCanReceiveProgrammaticFocus", () => {
    // Without tabindex="-1" the focus call silently does nothing.
    assert.match(html, /id="view-root"[^>]*tabindex="-1"/);
  });

  test("test_focus_viewRootDoesNotDrawARingWhenFocusedThisWay", () => {
    // An outline around the whole page on every navigation is noise. Genuine
    // keyboard focus elsewhere is unaffected — :focus-visible never matches a
    // programmatic focus.
    assert.match(css, /#view-root:focus \{ outline: none/);
  });
});

describe("when it moves", () => {
  test("test_focus_onlyOnARealNavigation", () => {
    // A sync landing or the day clock ticking re-renders the page. Yanking the
    // cursor then is worse than never moving it.
    assert.match(app, /if \(name === lastAnnounced\) return;/);
    assert.match(app, /viewChanged = true;/);
    assert.match(fn, /if \(!viewChanged \|\| !root\) return;/);
  });

  test("test_focus_theFlagIsClearedSoItFiresOnce", () => {
    assert.match(fn, /viewChanged = false;/);
  });

  test("test_focus_happensAfterTheViewIsPainted", () => {
    // Focusing an element whose contents are about to be replaced hands a
    // screen reader the page you just left.
    const render = app.indexOf("renderView();");
    const move = app.indexOf("moveFocusToView();", render);
    assert.ok(move > render, "focus is moved before the view renders");
  });
});

describe("when it refuses to move", () => {
  test("test_focus_neverStealsFromAFieldBeingTypedIn", () => {
    // A view can re-render while a form is open, and taking the cursor out
    // mid-sentence is the worst version of this bug.
    assert.match(fn, /INPUT\|TEXTAREA\|SELECT/);
  });

  test("test_focus_neverStealsFromAContentEditable", () => {
    assert.match(fn, /isContentEditable/);
  });

  test("test_focus_doesNotFightTheRendersScrollPosition", () => {
    assert.match(fn, /preventScroll: true/);
  });
});
