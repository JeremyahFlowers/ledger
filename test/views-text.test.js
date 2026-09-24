// Tests for the text helpers in js/ui.js.
//
// richText() introduces markup into user-visible strings, so the order of
// operations is a security property, not a style choice: escape first, then
// add the only tag it is allowed to add. These tests pin that, because the
// natural "improvement" of running the backtick replacement first would open
// an injection path through content that is otherwise trusted.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { esc, richText } from "../js/ui.js";

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

describe("the Reflect save gate", () => {
  // The recall question must be answered before a session saves — retrieving
  // the pattern yourself is the rep, and the whole app is built around it.
  //
  // It used to be enforced by disabling the save button and relabelling it.
  // Nothing in the stylesheet made a disabled button look disabled, so it
  // rendered as a bright, fully-opaque primary button that silently ignored
  // every click. A user with a finished session could not save it and had no
  // way to find out why. These pin the fix: the button stays live, and the
  // requirement explains itself on submit.
  // Reflect moved to session-view.js when views.js was split; the guarantee
  // is about the markup, not about which file holds it.
  const views = readFileSync(fileURLToPath(new URL("../js/session-view.js", import.meta.url)), "utf8");
  const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

  test("test_reflectSave_buttonIsNeverRenderedDisabled", () => {
    const button = views.match(/<button[^>]*id="reflect-save"[^>]*>/)[0];
    assert.doesNotMatch(button, /disabled/,
      "a dead-end button gives the user nothing to act on");
  });

  test("test_reflectSave_buttonLabelDoesNotChangeToAnInstruction", () => {
    assert.doesNotMatch(views, /Pick a pattern above first/,
      "the label should say what the button does, not why it won't");
  });

  test("test_reflectSubmit_unansweredRecall_explainsRatherThanReturningSilently", () => {
    const guard = views.slice(views.indexOf("if (!reflectState.patternAnswered) {"));
    const body = guard.slice(0, guard.indexOf("const f = new FormData(form)"));
    assert.match(body, /needs-answer/, "it should point at the question");
    assert.match(body, /scrollIntoView/, "the question may be off screen");
    assert.match(body, /toast\(/, "and say why in words");
  });

  test("test_disabledButtons_areVisuallyDistinct", () => {
    // The root cause: no rule in the stylesheet distinguished one.
    assert.match(styles, /\.btn:disabled/);
    assert.match(styles, /cursor:\s*not-allowed/);
  });
});

describe("charts describe themselves", () => {
  // The line charts always carried a sentence summary. The volume bars and the
  // mastery rings carried `title` attributes, which most screen readers ignore
  // outright — so half the Progress page was readable only if you could see
  // it.
  // Read every module that renders, rather than a hand-kept list of two. The
  // first version of this named views.js and progress-view.js, and the moment
  // the charts moved into chrome.js it would have gone on passing while
  // checking nothing.
  const sources = readdirSync(fileURLToPath(new URL("../js", import.meta.url)))
    .filter((f) => f.endsWith(".js"))
    .map((f) => [f, readFileSync(fileURLToPath(new URL(`../js/${f}`, import.meta.url)), "utf8")]);
  const sourceOf = (name) => sources.find(([f]) => f === name)[1];
  const progress = sourceOf("progress-view.js");

  test("test_charts_everySvgChartHasARoleAndAName", () => {
    // A bare <svg> is announced as nothing at all.
    let seen = 0;
    for (const [file, src] of sources) {
      const charts = src.match(/<svg[^>]*class="(chart|ring|heatmap|week-strip)"[^>]*/g) || [];
      seen += charts.length;
      for (const tag of charts) {
        assert.match(tag, /role="img"/, `${file}: ${tag.slice(0, 60)} needs role="img"`);
        assert.match(tag, /aria-label=/, `${file}: ${tag.slice(0, 60)} needs a name`);
      }
    }
    assert.ok(seen > 0, "no charts found at all — the pattern has drifted, not the charts");
  });

  test("test_volumeChart_hasASentenceNotJustTitles", () => {
    assert.match(progress, /role="img" aria-label="\$\{esc\(describeVolume\(weeks\)\)\}"/);
    // And the decorative bars are hidden, so a reader gets the sentence once
    // rather than the sentence plus seven unlabelled list items.
    assert.match(progress, /<li aria-hidden="true">/);
  });

  test("test_volumeDescription_namesTheGaps", () => {
    // A gap is the part of this chart most worth knowing about.
    const fn = progress.slice(progress.indexOf("function describeVolume"));
    assert.match(fn.slice(0, fn.indexOf("function moversHtml")), /with none/);
  });

  test("test_rings_fallBackToAPercentageRatherThanNothing", () => {
    // Every call site passes a description, but a new one that forgets should
    // still announce something true.
    assert.match(sourceOf("chrome.js"), /description \|\| `\$\{Math\.round\(f \* 100\)\}% complete`/);
  });
});
