// One rule for destroying things, checked against the source.
//
// The app had three: removing an attempt or a bank problem offered an undo,
// removing a resource link happened silently with no confirmation and no way
// back, and disconnecting asked through a bare browser confirm() — three
// behaviours for the same kind of act, with the quietest one on the action
// that could not be reversed.
//
// The rule now: removing one item from a list happens immediately and offers
// an undo, because it is recoverable and a dialog is only in the way. Anything
// the app cannot undo afterwards — replacing the whole log, forgetting the
// credentials, discarding the other device's copy, throwing away an unsaved
// session — asks first, and says what is lost *and* what survives.
//
// These read the source because what is being pinned is a convention, and a
// convention is only worth having if a new call site can't quietly break it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { confirmLoss } from "../js/ui.js";

const JS = fileURLToPath(new URL("../js", import.meta.url));
const sources = readdirSync(JS)
  .filter((f) => f.endsWith(".js"))
  .map((f) => [f, readFileSync(`${JS}/${f}`, "utf8")]);
const sourceOf = (name) => sources.find(([f]) => f === name)[1];

describe("confirmLoss", () => {
  const ask = (over = {}) => {
    let asked = null;
    global.window = { confirm: (text) => { asked = text; return true; } };
    confirmLoss({ action: "Disconnect?", lost: "the token on this device", kept: "your repo", ...over });
    delete global.window;
    return asked;
  };

  test("test_confirmLoss_asksTheQuestionFirst", () => {
    assert.match(ask(), /^Disconnect\?/);
  });

  test("test_confirmLoss_namesWhatGoes", () => {
    assert.match(ask(), /discards: the token on this device/);
  });

  test("test_confirmLoss_namesWhatSurvives", () => {
    // Most of these are far less frightening than they sound, and saying so is
    // what stops the dialog being clicked through on reflex.
    assert.match(ask(), /keeps: your repo/);
  });

  test("test_confirmLoss_returnsTheAnswer", () => {
    global.window = { confirm: () => false };
    assert.equal(confirmLoss({ action: "a", lost: "b", kept: "c" }), false);
    global.window = { confirm: () => true };
    assert.equal(confirmLoss({ action: "a", lost: "b", kept: "c" }), true);
    delete global.window;
  });
});

describe("the convention holds across the app", () => {
  test("test_destructive_noBareConfirmSurvives", () => {
    // A bare confirm() is how the three different dialogs happened: each call
    // site invented its own wording, and one of them forgot to mention that
    // the code went with the session.
    for (const [file, src] of sources) {
      if (file === "ui.js") continue;  // confirmLoss is the one place it is allowed
      const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
      assert.doesNotMatch(code, /(?<![.\w])confirm\s*\(/,
        `${file} calls confirm() directly — use confirmLoss so it says what is kept`);
    }
  });

  test("test_destructive_everyConfirmLossCallSaysAllThree", () => {
    for (const [file, src] of sources) {
      if (file === "ui.js") continue;  // its own signature, not a call
      for (const call of src.match(/confirmLoss\(\{[\s\S]*?\}\)/g) || []) {
        for (const part of ["action:", "lost:", "kept:"]) {
          assert.ok(call.includes(part), `${file}: a confirmLoss call is missing ${part}`);
        }
      }
    }
  });

  test("test_destructive_removingOneThingOffersUndo", () => {
    // The three list removals in the app. If a fourth appears it should be
    // here too, which is the point of naming them.
    const removals = [
      ["detail-view.js", "Removed that attempt"],
      ["bank-view.js", "from your bank"],
      ["views.js", "removeResource"],
    ];
    for (const [file, marker] of removals) {
      const src = sourceOf(file);
      assert.ok(src.includes(marker), `${file} no longer contains ${marker}`);
      assert.match(src, /offerUndo\(/, `${file} removes something without offering an undo`);
    }
  });

  test("test_destructive_leavingASessionIsAskedInExactlyOnePlace", () => {
    // There were three exits from a session and three different questions.
    const asks = sources.filter(([, src]) => /Discard this session\?/.test(src));
    assert.equal(asks.length, 1, `asked in: ${asks.map(([f]) => f).join(", ")}`);
    assert.equal(asks[0][0], "session-view.js");
  });

  test("test_destructive_sessionDiscardMentionsTheCode", () => {
    // The nav's version used to say only "Leave without saving this session?",
    // which does not tell you the editor's contents go with it.
    const fn = sourceOf("session-view.js");
    const block = fn.slice(fn.indexOf("export function discardSession"));
    assert.match(block.slice(0, 600), /code/);
  });
});
