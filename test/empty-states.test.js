// Every empty state offers the one action that ends it.
//
// The first hour with this app is the one that decides whether there is a
// second, and it is spent almost entirely looking at empty states: no notes,
// no mocks, no boards, nothing logged. Each was written where it sits, and
// four of the eight offered no way forward at all — not because nobody thought
// of one, but because emptyState() could only emit a tab jump, and the answer
// to those four was on the same page they were already looking at.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { emptyState } from "../js/chrome.js";

const JS = fileURLToPath(new URL("../js", import.meta.url));
const sources = readdirSync(JS)
  .filter((f) => f.endsWith(".js"))
  .map((f) => [f, readFileSync(`${JS}/${f}`, "utf8")]);

describe("emptyState markup", () => {
  test("test_emptyState_withNoAction_rendersNoButton", () => {
    const html = emptyState("log", "Nothing here", "Some explanation.");
    assert.doesNotMatch(html, /<button/);
  });

  test("test_emptyState_tabAction_emitsANavigationButton", () => {
    const html = emptyState("log", "H", "E", { tab: "queue", label: "Go" });
    assert.match(html, /data-goto="queue"/);
    assert.match(html, />Go</);
  });

  test("test_emptyState_focusAction_emitsAFocusButton", () => {
    const html = emptyState("log", "H", "E", { focus: "#f [name=text]", label: "Write one" });
    assert.match(html, /data-goto-focus="#f \[name=text\]"/);
    assert.doesNotMatch(html, /data-goto="/, "a focus action must not also navigate");
  });

  test("test_emptyState_escapesEverythingItIsGiven", () => {
    const html = emptyState("log", "<script>", "a & b", { tab: "q\"x", label: "<b>" });
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /<b>/);
    assert.match(html, /a &amp; b/);
  });

  test("test_emptyState_alwaysSaysWhyItIsEmpty", () => {
    // The headline alone is "No boards saved yet", which is what the user can
    // already see. The explanation is the part that says why it is worth
    // fixing.
    const html = emptyState("log", "No boards saved yet", "Sketching is most of the work.");
    assert.match(html, /Sketching is most of the work\./);
  });
});

describe("the app's own empty states", () => {
  const calls = sources.flatMap(([file, src]) =>
    [...src.matchAll(/emptyState\(\s*("[^"]*")\s*,\s*("[^"]*")([\s\S]*?)\)\s*(?::|\}|\n)/g)]
      .map((m) => ({ file, headline: m[2], rest: m[3] })));

  test("test_emptyStates_thereAreSomeToCheck", () => {
    assert.ok(calls.length >= 8, `only found ${calls.length}`);
  });

  test("test_emptyStates_everyOneOffersAWayOut", () => {
    for (const c of calls) {
      assert.ok(/\btab:|\bfocus:/.test(c.rest),
        `${c.file}: ${c.headline} tells the user it is empty and not how to start`);
    }
  });

  test("test_emptyStates_aFocusTargetIsASelectorNotATabName", () => {
    // A tab id here would silently match nothing and the button would do
    // nothing, which is worse than having no button.
    for (const c of calls) {
      const focus = /focus:\s*"([^"]*)"/.exec(c.rest);
      if (focus) assert.match(focus[1], /^[#.\[]/, `${c.file}: focus "${focus[1]}" is not a selector`);
    }
  });
});
