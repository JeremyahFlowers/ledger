// System design as part of the same app, not beside it.
//
// The brief's framing, which these pin: "we should consider it part of the same
// whole ... system design prep should be comingled with coding interview prep."
// So the tests here are mostly about shared machinery — one day's budget, one
// search bar, one drill page, one Progress page, one scheduler — rather than
// about design features in isolation.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { COMPONENTS } from "../js/design-components.js";
import { DESIGN_PROBLEMS } from "../js/design-problems.js";
import {
  pickComponentQuestion, componentOptions, componentById, splitBudget,
} from "../js/design-logic.js";
import { buildSeedState, migrateState } from "../js/seed.js";
import { OUTCOMES } from "../js/logic.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const app = read("../js/app.js");
const views = read("../js/views.js");
const drill = read("../js/drill-view.js");
const session = read("../js/design-session.js");
const progress = read("../js/progress-view.js");

describe("it is part of the same app", () => {
  test("test_integration_designIsATopLevelSectionNotALockedPage", () => {
    // It used to be a page under Track, gated on ten mock interviews. That made
    // design something you earned after coding, which is the opposite of
    // preparing for both in one loop.
    assert.match(app, /design: \{\s*label: "System Design"/);
    assert.doesNotMatch(app, /id: "systemDesign", label: "System Design"/);
  });

  test("test_integration_theUnlockGateIsGone", () => {
    assert.doesNotMatch(app, /systemDesignUnlock\(state\)\.unlocked \? "Unlocked"/);
  });

  test("test_integration_aDesignProblemUsesTheSameScheduler", () => {
    // Same boxes, same intervals. A design problem is a problem with a
    // different practice format, not a different kind of thing.
    assert.match(session, /applyOutcome\(record, outcomeFor\(selfScore\), s\.settings\)/);
    assert.match(session, /updateStreak\(s\)/);
  });

  test("test_integration_theSelfScoreMapsOntoRealOutcomes", () => {
    // Not a parallel vocabulary. The scheduler already knows these four.
    const known = new Set(OUTCOMES.map((o) => o.value));
    for (const outcome of ["solved-clean", "solved-struggled", "ran-out-of-time", "failed"]) {
      assert.ok(known.has(outcome), `${outcome} is not a real outcome`);
      assert.match(session, new RegExp(`"${outcome}"`), `outcomeFor never returns ${outcome}`);
    }
  });

  test("test_integration_aDesignSessionReusesTheBoardAndBothSyncChannels", () => {
    // Built twice would be two whiteboards to keep in step and two sync paths
    // to debug.
    assert.match(session, /from "\.\/whiteboard\.js"/);
    assert.match(session, /createRepoChannel/);
    assert.match(session, /createLiveChannel/);
  });

  test("test_integration_aDesignAttemptRecordsWhetherTheClockCountedIt", () => {
    // The double-count bug the coding half had, not repeated on this one.
    assert.match(session, /onClock: !!\(s\.dayTimer\?\.running && s\.dayTimer\.date === date\)/);
  });

  test("test_integration_theDashboardHasOneRecommendationNotTwo", () => {
    // Two things telling you what to do next is two people talking over each
    // other. The design card sits below the coding one and says less.
    const card = views.slice(views.indexOf("function designCardHtml"));
    assert.match(card.slice(0, 2000), /recommendDesign\(state\)/);
    assert.match(views, /deliberately a second card rather than a competing headline/i);
  });

  test("test_integration_progressCoversBothHalvesOnOnePage", () => {
    assert.match(progress, /function designProgressHtml/);
    assert.match(progress, /designProgressHtml\(store\.state\)/);
  });

  test("test_integration_bothDrillsAreOnOnePage", () => {
    // Two drills in two places would be two habits to build.
    assert.match(drill, /data-quiz-mode="pattern"/);
    assert.match(drill, /data-quiz-mode="component"/);
  });
});

describe("the day is split, not doubled", () => {
  test("test_integration_theBriefsExampleIsThePreset", () => {
    // "if the user does 45 minutes of coding interview prep, they should
    // complement that with 30 minutes of system design prep if their goal is 75
    // minutes of total daily learning"
    const split = splitBudget({ settings: { dailyBudgetMin: 75, designShare: 0.4 } });
    assert.equal(split.codingMin, 45);
    assert.equal(split.designMin, 30);
  });

  test("test_integration_aNewLogStartsWithDesignOff", () => {
    assert.equal(buildSeedState().settings.designShare, 0);
  });

  test("test_integration_anExistingLogIsNotQuietlyChanged", () => {
    // Somebody who never asked for design must not lose coding minutes to it.
    const migrated = migrateState({ settings: { dailyBudgetMin: 75 }, problems: [], patterns: [] });
    assert.equal(migrated.settings.designShare, 0);
    assert.equal(splitBudget(migrated).codingMin, 75);
  });

  test("test_integration_aNewLogIsSeededWithTheBank", () => {
    const seeded = buildSeedState();
    assert.equal(seeded.designProblems.length, DESIGN_PROBLEMS.length);
    assert.ok(seeded.designProblems.every((p) => p.box === 0 && p.attempts.length === 0));
  });

  test("test_integration_aNewProblemInTheBankReachesAnExistingLog", () => {
    // The bank grows with releases; a log written before one should get it.
    const migrated = migrateState({
      settings: {}, problems: [], patterns: [],
      designProblems: [{ id: "url-shortener", name: "x", difficulty: "Easy", status: "active", box: 2, nextReviewDate: "2026-01-01", attempts: [{ id: "a" }] }],
    });
    assert.equal(migrated.designProblems.length, DESIGN_PROBLEMS.length);
    const kept = migrated.designProblems.find((p) => p.id === "url-shortener");
    assert.equal(kept.box, 2, "an existing record was overwritten");
    assert.equal(kept.attempts.length, 1);
  });
});

describe("the component drill", () => {
  const state = { settings: { designShare: 0.4 }, designProblems: [] };

  test("test_drill_theAnswerIsAlwaysAmongTheOptions", () => {
    for (let i = 0; i < 40; i++) {
      const c = pickComponentQuestion(state);
      assert.ok(componentOptions(c).includes(c.id));
    }
  });

  test("test_drill_thereAreAlwaysFourOptions", () => {
    // Fewer would make a small category a coin flip.
    for (const component of COMPONENTS) {
      assert.equal(componentOptions(component).length, 4, component.id);
    }
  });

  test("test_drill_optionsAreDistinct", () => {
    for (const component of COMPONENTS) {
      const options = componentOptions(component);
      assert.equal(new Set(options).size, options.length, component.id);
    }
  });

  test("test_drill_distractorsPreferTheSameFamily", () => {
    // "Is this a cache or a load balancer" is not a question anybody gets
    // wrong. "Is this Redis or a CDN" is.
    let sameFamily = 0;
    const tries = 60;
    for (let i = 0; i < tries; i++) {
      const c = pickComponentQuestion(state);
      const options = componentOptions(c).map((id) => componentById(id));
      if (options.every((o) => o.category === c.category)) sameFamily += 1;
    }
    assert.ok(sameFamily > tries * 0.3,
      `only ${sameFamily}/${tries} draws stayed in one family — distractors are too easy`);
  });

  test("test_drill_itAvoidsWhatItJustAsked", () => {
    const recent = COMPONENTS.slice(0, 5).map((c) => c.id);
    for (let i = 0; i < 30; i++) {
      assert.ok(!recent.includes(pickComponentQuestion(state, recent).id));
    }
  });

  test("test_drill_everyComponentCanBeAsked", () => {
    // A component that can never come up is a page nobody is sent to.
    const asked = new Set();
    for (let i = 0; i < 4000; i++) asked.add(pickComponentQuestion(state).id);
    assert.equal(asked.size, COMPONENTS.length);
  });

  test("test_drill_avoidingEverythingDoesNotThrow", () => {
    const all = COMPONENTS.map((c) => c.id);
    assert.equal(pickComponentQuestion(state, all), null);
  });

  test("test_drill_theQuestionIsTheDescriptionNotTheName", () => {
    // Showing the name and asking for the name is not recall.
    assert.match(drill, /\$\{esc\(c\.concept\)\}/);
  });
});

describe("the drill switch works on every screen it appears on", () => {
  // Found in a browser: the pattern drill's empty state returned before wiring,
  // so the switch to the component drill did nothing — on a fresh account, the
  // only screen it appears on. The same shape as the save button that was
  // styled as enabled and wasn't.
  const drillSrc = read("../js/drill-view.js");

  test("test_drill_theEmptyStateWiresTheSwitchBeforeReturning", () => {
    const emptyPath = drillSrc.slice(
      drillSrc.indexOf('emptyState("quiz", "Nothing to drill yet"'),
      drillSrc.indexOf("const p = quizState.current;"));
    assert.match(emptyPath, /wireModeSwitch\(root, actions\)/);
    assert.ok(emptyPath.indexOf("wireModeSwitch") < emptyPath.indexOf("return;"),
      "the switch is wired after the function returns");
  });

  test("test_drill_everyScreenThatShowsTheSwitchAlsoWiresIt", () => {
    // One per render path: the empty pattern state, the pattern question, and
    // the component question.
    const shown = (drillSrc.match(/modeSwitchHtml\(/g) || []).length;
    const wired = (drillSrc.match(/wireModeSwitch\(root, actions\)/g) || []).length;
    assert.ok(wired >= shown - 1,
      `the switch is rendered ${shown} times and wired ${wired}`);
  });
});
