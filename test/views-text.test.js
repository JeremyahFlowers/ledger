// Tests for the text helpers in js/views.js.
//
// richText() introduces markup into user-visible strings, so the order of
// operations is a security property, not a style choice: escape first, then
// add the only tag it is allowed to add. These tests pin that, because the
// natural "improvement" of running the backtick replacement first would open
// an injection path through content that is otherwise trusted.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { esc, richText } from "../js/views.js";

describe("esc", () => {
  test("test_esc_htmlSpecialCharacters_areAllEscaped", () => {
    assert.equal(esc('<a href="x">&\'</a>'),
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });

  test("test_esc_nullish_becomesEmptyStringNotTheWordUndefined", () => {
    assert.equal(esc(null), "");
    assert.equal(esc(undefined), "");
  });

  test("test_esc_numbers_areStringified", () => {
    assert.equal(esc(42), "42");
  });
});

describe("richText", () => {
  test("test_richText_backtickSpans_becomeCodeElements", () => {
    assert.equal(richText("Use `while` not `if`"),
      "Use <code>while</code> not <code>if</code>");
  });

  test("test_richText_plainProse_isUnchanged", () => {
    assert.equal(richText("No code here."), "No code here.");
  });

  test("test_richText_escapesBeforeAddingMarkup", () => {
    // The whole safety argument: by the time the backtick replacement runs
    // there are no angle brackets left for it to reopen.
    const out = richText("`<script>alert(1)</script>`");
    assert.ok(!out.includes("<script"), `injection survived: ${out}`);
    assert.equal(out, "<code>&lt;script&gt;alert(1)&lt;/script&gt;</code>");
  });

  test("test_richText_codeSpanContainingMarkup_staysEscapedInsideTheTag", () => {
    assert.equal(richText("compare `a < b`"), "compare <code>a &lt; b</code>");
  });

  test("test_richText_unpairedBacktick_isLeftAlone", () => {
    assert.equal(richText("a ` b"), "a ` b");
  });

  test("test_richText_ampersandInsideCode_isEscapedOnce", () => {
    // Double-escaping would render "&amp;amp;" on screen.
    assert.equal(richText("`a & b == c`"), "<code>a &amp; b == c</code>");
  });

  test("test_richText_nullish_returnsEmptyString", () => {
    assert.equal(richText(null), "");
  });
});
