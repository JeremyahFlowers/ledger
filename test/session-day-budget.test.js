// The day budget, as a session bar shows it (js/chrome.js).
//
// Where this fits: the floating plant panel carries the day budget on every
// other screen, and is hidden on the two session views because they own the
// viewport — on a three-pane workspace it lands on the whiteboard canvas, not
// beside it. So the number has to be in the bar, and both session views have to
// say it the same way, which is why there is one function rather than a copy in
// each.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { updateDayBudget } from "../js/chrome.js";
import { todayISO } from "../js/logic.js";

const MIN = 60_000;
const NOW = 1_800_000_000_000;

/** A element stub with just the surface updateDayBudget touches. */
function makeSubject({ clockMin = 0, budget = 75, solvedMin = null } = {}) {
  const classes = new Set();
  const el = {
    textContent: "",
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      has: (n) => classes.has(n),
    },
  };
  const state = {
    settings: { dailyBudgetMin: budget },
    dayTimer: { date: todayISO(), running: true, startedAt: NOW - clockMin * MIN, accumulatedMs: 0, adjustmentMs: 0 },
    problems: [{
      id: "p1", name: "P", number: 1, difficulty: "Medium", patternId: "x",
      status: "active", box: 1, nextReviewDate: todayISO(),
      attempts: solvedMin == null ? [] : [{
        id: "a1", date: todayISO(), outcome: "solved-clean", patternGuess: "correct",
        timeToInsightMin: 5, timeToSolveMin: solvedMin, mistakeTags: [], onClock: false,
      }],
    }],
  };
  return { el, state, classes };
}

describe("what the line says", () => {
  test("test_updateDayBudget_withTimeLeft_saysHowMuchOfWhat", () => {
    const { el, state } = makeSubject({ clockMin: 22, budget: 75 });
    updateDayBudget(el, state, NOW);
    assert.equal(el.textContent, "53 min left of today's 75");
  });

  test("test_updateDayBudget_pastBudget_saysHowFarPast", () => {
    const { el, state } = makeSubject({ clockMin: 90, budget: 75 });
    updateDayBudget(el, state, NOW);
    assert.equal(el.textContent, "15 min past today's 75");
  });

  test("test_updateDayBudget_exactlyAtBudget_doesNotReadAsPast", () => {
    const { el, state } = makeSubject({ clockMin: 75, budget: 75 });
    updateDayBudget(el, state, NOW);
    assert.match(el.textContent, /left of today's 75$/);
  });

  test("test_updateDayBudget_freshDay_countsTheWholeBudget", () => {
    const { el, state } = makeSubject({ clockMin: 0, budget: 45 });
    updateDayBudget(el, state, NOW);
    assert.equal(el.textContent, "45 min left of today's 45");
  });
});

describe("how it is marked", () => {
  test("test_updateDayBudget_underBudget_carriesNeitherWarning", () => {
    const { el, state, classes } = makeSubject({ clockMin: 10 });
    updateDayBudget(el, state, NOW);
    assert.equal(classes.has("budget-warn"), false);
    assert.equal(classes.has("budget-over"), false);
  });

  test("test_updateDayBudget_overBudget_isMarkedOver", () => {
    const { el, state, classes } = makeSubject({ clockMin: 200, budget: 75 });
    updateDayBudget(el, state, NOW);
    assert.equal(classes.has("budget-over"), true, "a long overrun is not marked as one");
  });

  test("test_updateDayBudget_returningUnderBudget_clearsTheMarking", () => {
    // The same element is written every tick, so a class set once has to come
    // back off — the readout would otherwise stay red for the rest of the day
    // after the budget was raised in Settings.
    const over = makeSubject({ clockMin: 200, budget: 75 });
    updateDayBudget(over.el, over.state, NOW);
    assert.equal(over.classes.has("budget-over"), true);

    over.state.settings.dailyBudgetMin = 600;
    updateDayBudget(over.el, over.state, NOW);
    assert.equal(over.classes.has("budget-over"), false, "the marking outlived the overrun");
    assert.equal(over.classes.has("budget-warn"), false);
  });
});

describe("what it does with nothing to say", () => {
  test("test_updateDayBudget_nullElement_doesNotThrow", () => {
    const { state } = makeSubject();
    assert.doesNotThrow(() => updateDayBudget(null, state, NOW));
  });

  test("test_updateDayBudget_nullState_doesNotThrow", () => {
    // The tick can outlive a render by up to 250ms, and store.state is null
    // while a reload is in flight.
    const { el } = makeSubject();
    assert.doesNotThrow(() => updateDayBudget(el, null, NOW));
    assert.equal(el.textContent, "");
  });
});
