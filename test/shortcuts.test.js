// Tests for js/shortcuts.js.
//
// The behaviour (key sequences, the dialog, ignoring keystrokes while typing)
// is browser-level and tested there. What is worth pinning here is the thing
// that breaks silently: a shortcut pointing at a tab id that no longer exists.
// Renaming a page would leave `g b` doing nothing at all, with no error
// anywhere, and nobody would notice until they pressed it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { GO_TO, DIRECT } from "../js/shortcuts.js";

/** Tab ids registered in app.js, read from source rather than imported —
 * importing app.js would boot the whole application. */
function registeredTabIds() {
  const src = readFileSync(fileURLToPath(new URL("../js/app.js", import.meta.url)), "utf8");
  const ids = new Set();
  // STANDALONE keys: `dashboard: { label: ... }`
  const standalone = src.slice(src.indexOf("const STANDALONE"), src.indexOf("const SECTIONS"));
  for (const m of standalone.matchAll(/^\s{2}(\w+):\s*\{/gm)) ids.add(m[1]);
  // SECTIONS keys and their page ids
  const sections = src.slice(src.indexOf("const SECTIONS"), src.indexOf("const PAGE_TO_SECTION"));
  for (const m of sections.matchAll(/^\s{2}(\w+):\s*\{/gm)) ids.add(m[1]);
  for (const m of sections.matchAll(/\{\s*id:\s*"([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

describe("shortcut destinations", () => {
  test("test_goTo_everyTargetIsARegisteredTab", () => {
    const registered = registeredTabIds();
    assert.ok(registered.size > 8, `only found ${registered.size} tab ids — the parser is wrong, not the app`);
    for (const [key, { tab }] of Object.entries(GO_TO)) {
      assert.ok(registered.has(tab), `"g ${key}" points at "${tab}", which is not a registered tab`);
    }
  });

  test("test_goTo_keysAreUnique", () => {
    const keys = Object.keys(GO_TO);
    assert.equal(new Set(keys).size, keys.length);
  });

  test("test_goTo_keysAreSingleLowercaseLetters", () => {
    // The handler lowercases the pressed key before matching, so an uppercase
    // or multi-character entry here could never be reached.
    for (const key of Object.keys(GO_TO)) {
      assert.match(key, /^[a-z]$/, `"${key}" can never match a keypress`);
    }
  });

  test("test_goTo_everyTargetHasALabelForTheHelpDialog", () => {
    for (const [key, entry] of Object.entries(GO_TO)) {
      assert.ok(entry.label && entry.label.length > 1, `"g ${key}" has no readable label`);
    }
  });

  test("test_goTo_coversEveryChapter", () => {
    // The chapters are the top-level nav; each should be one keystroke away.
    const targets = new Set(Object.values(GO_TO).map((e) => e.tab));
    for (const chapter of ["dashboard", "practice", "learn", "track", "settings"]) {
      assert.ok(targets.has(chapter), `no shortcut reaches "${chapter}"`);
    }
  });

  test("test_direct_documentsEveryActionKeyItHandles", () => {
    // The dialog is the only discovery mechanism, so anything the handler acts
    // on has to appear in it.
    for (const key of ["?", "/", "s", "Escape"]) {
      assert.ok(key in DIRECT, `"${key}" is handled but undocumented`);
    }
  });

  test("test_direct_doesNotClaimAKeyUsedToStartASequence", () => {
    // `g` begins a sequence; binding it as a direct action too would make one
    // of the two unreachable.
    assert.ok(!("g" in DIRECT));
  });
});
