// Tests for the first-run introduction (js/welcome.js).
//
// A new account landed on a dashboard holding a plant, a budget ring, a
// recommendation and a 23-pattern taxonomy, with no indication what any of it
// was for. The reasoning behind every one of those is written down — in source
// comments and a changelog, where nobody looks. An app whose whole argument is
// "don't grind, practise deliberately" has to make that argument somewhere the
// user actually is.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../js/welcome.js", import.meta.url)), "utf8");
const app = readFileSync(fileURLToPath(new URL("../js/app.js", import.meta.url)), "utf8");

describe("the introduction's content", () => {
  test("test_welcome_saysWhatTheAppIsFor", () => {
    // Each screen answers one question a new user would actually ask, rather
    // than touring the UI.
    for (const phrase of ["not a leaderboard", "Patterns, not problems",
                          "without deadlines", "Stopping is part of it"]) {
      assert.ok(source.includes(phrase), `missing the screen about "${phrase}"`);
    }
  });

  test("test_welcome_isShort", () => {
    // Onboarding that outstays its welcome gets skipped, and then nothing was
    // explained at all.
    const steps = source.match(/^\s*\{\s*$/gm) || [];
    assert.ok(source.split("title:").length - 1 <= 5, "four or five screens, not a manual");
  });

  test("test_welcome_saysWhereTheDataGoes", () => {
    // The first question anyone should ask of a tool holding their work.
    assert.match(source, /own GitHub repository/);
    assert.match(source, /never sends it anywhere else/);
  });

  test("test_welcome_canBeSkipped", () => {
    // An onboarding nobody can escape is its own kind of disrespect, and the
    // app is perfectly usable without any of it.
    assert.match(source, /welcome-skip/);
  });
});

describe("how it's remembered", () => {
  test("test_welcome_flagIsPerDeviceNotInSyncedState", () => {
    // It is about this browser, not about the prep log — syncing it would
    // mean a new device silently skips the introduction.
    assert.match(source, /localStorage/);
    assert.doesNotMatch(source, /store\.mutate/);
  });

  test("test_welcome_storageFailure_doesNotTrapTheUser", () => {
    // A browser that refuses storage must not get stuck on onboarding
    // forever, so the failure case reports "already seen".
    const fn = source.slice(source.indexOf("export function hasSeenWelcome"));
    assert.match(fn.slice(0, 300), /return true/);
  });

  test("test_welcome_canBeReplayed", () => {
    assert.match(source, /export function resetWelcome/);
  });
});

describe("what it hides while it's up", () => {
  test("test_welcome_chromeIsHiddenDuringTheIntroduction", () => {
    // A plant and a countdown in the corner of the page explaining what a
    // plant and a countdown are for is the confusion this exists to clear up.
    assert.match(app, /nav\.hidden = true;/);
    assert.match(app, /topbar-search"\)\.hidden = true/);
  });

  test("test_welcome_plantVisibilityIsDecidedWhereTheClockCanSeeIt", () => {
    // The ticking clock re-renders the plant every second, so hiding it at
    // the point the welcome screen is drawn is undone a second later.
    assert.match(app, /PLANT_WIDGET_HIDDEN_ON\.has\(activeTab\) && hasSeenWelcome\(\)/);
  });
});
