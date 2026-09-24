// Tests for js/errors.js and the no-silent-failure rule it exists to enforce.
//
// The rule came from a real failure: a session could not be saved because the
// save button refused and said nothing. It was not a crash — the code did
// exactly what it was written to do — and that is the point. An unhandled
// rejection, an uncaught throw and a silent early return all look identical
// from the outside: a control that does nothing.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("AppError", () => {
  test("test_appError_carriesAMessageFitToShow", async () => {
    const { AppError } = await import("../js/errors.js");
    const err = new AppError("Your bank is full.", { code: "bank_full" });
    assert.equal(err.message, "Your bank is full.");
    assert.equal(err.code, "bank_full");
    assert.ok(err instanceof Error, "must still behave as an Error");
  });

  test("test_appError_keepsTheUnderlyingCauseForLogging", async () => {
    const { AppError } = await import("../js/errors.js");
    const root = new Error("HTTP 500");
    assert.equal(new AppError("Couldn't sync.", { cause: root }).cause, root);
  });

  test("test_appError_defaultsItsCode", async () => {
    const { AppError } = await import("../js/errors.js");
    assert.equal(new AppError("x").code, "app_error");
  });
});

describe("the no-silent-failure rule", () => {
  const errors = read("../js/errors.js");
  const app = read("../js/app.js");

  test("test_errors_installsBothGlobalHandlers", () => {
    // They catch different things: one synchronous throws that escaped every
    // try block, the other async rejections. Either alone leaves a gap.
    assert.match(errors, /addEventListener\("error"/);
    assert.match(errors, /addEventListener\("unhandledrejection"/);
  });

  test("test_errors_bannerUsesTextContentNotInnerHtml", () => {
    // An error message can contain anything, including a server's response
    // body. It is untrusted by the time it reaches here.
    const show = errors.slice(errors.indexOf("function showBanner"));
    assert.match(show.slice(0, show.indexOf("installErrorHandling")), /textContent = message/);
  });

  test("test_errors_stackTracesAreLoggedNotShown", () => {
    // Internal detail goes to the console; the user gets a sentence.
    assert.match(errors, /console\.error/);
    const humanize = errors.slice(errors.indexOf("function humanize"));
    assert.doesNotMatch(humanize.slice(0, 400), /err\.stack/);
  });

  test("test_errors_faultLogIsBounded", () => {
    // A debugging aid, not a log file — it must not grow without limit.
    assert.match(errors, /MAX_REMEMBERED/);
    assert.match(errors, /remembered\.shift\(\)/);
  });

  test("test_app_installsErrorHandlingBeforeTheFirstRender", () => {
    const install = app.indexOf("installErrorHandling()");
    const firstRender = app.indexOf("renderAll();", install > 0 ? 0 : 0);
    assert.ok(install > 0, "error handling must be installed at boot");
    assert.ok(install < app.lastIndexOf("renderAll();"),
      "a throw during the first render would otherwise go unreported");
  });

  test("test_app_aThrowingViewDoesNotBlankTheApp", () => {
    // A view that throws used to empty <main> and stop, which looks exactly
    // like a broken app and explains nothing.
    assert.match(app, /function renderView\(\)\s*\{\s*try\s*\{/);
    assert.match(app, /This page couldn't be shown/);
  });

  test("test_app_theTickingClockCannotDieSilently", () => {
    // It runs every second forever; one unguarded throw would either repeat
    // the failure endlessly or stop the clock with no sign of why.
    assert.match(app, /setInterval\(guard\(/);
  });
});
