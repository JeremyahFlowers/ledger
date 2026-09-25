// The plant, as drawn (js/plant.js).
//
// computePlantState is tested thoroughly. plantSvg — which turns that verdict
// into the thing you actually look at every day, and which is the app's
// headline judgment — had no tests at all.
//
// Two of these guard mistakes already made. The decorative plants were once
// emitted as `role="img" aria-label=""`, which a screen reader announces as an
// unlabelled image: worse than saying nothing, and worse for being in four
// places at once. And a stage key that isn't in the table has to draw
// something, because a stage that renders nothing is an empty box where the
// plant was, with no error to explain it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { plantSvg } from "../js/plant.js";
import { PLANT_STAGES } from "../js/logic.js";

const VITALITIES = ["thriving", "steady", "stressed", "wilting"];
const STAGES = PLANT_STAGES.map((s) => s.key);

describe("every stage and vitality draws something", () => {
  test("test_plant_everyStageInTheLadderHasADrawing", () => {
    // PLANT_STAGES is what the dashboard's growth path iterates. A stage there
    // with no drawer here is a gap in the ladder nothing else would catch.
    for (const stage of STAGES) {
      const svg = plantSvg(stage, "steady");
      assert.match(svg, /<svg/, `${stage} produced no svg`);
      assert.ok(svg.length > 200, `${stage} drew almost nothing`);
    }
  });

  test("test_plant_everyVitalityHasAPalette", () => {
    const drawings = VITALITIES.map((v) => plantSvg("budding", v));
    assert.equal(new Set(drawings).size, VITALITIES.length,
      "two vitalities render identically — one is falling back to another's palette");
  });

  test("test_plant_unknownStage_fallsBackRatherThanDrawingNothing", () => {
    // An empty box where the plant was, with no error to explain it.
    const svg = plantSvg("not-a-stage", "steady");
    assert.match(svg, /<svg/);
    assert.ok(svg.length > 200);
  });

  test("test_plant_unknownVitality_fallsBackToSteady", () => {
    assert.equal(plantSvg("seedling", "nonsense"), plantSvg("seedling", "steady"));
  });
});

describe("how it is announced", () => {
  test("test_plant_labelledUse_saysWhatItIsAndHowItIsDoing", () => {
    const svg = plantSvg("budding", "stressed");
    assert.match(svg, /role="img"/);
    assert.match(svg, /aria-label="Practice plant, budding, stressed"/);
  });

  test("test_plant_decorativeUse_isRemovedFromTheTreeEntirely", () => {
    // Not given an empty name: <svg role="img" aria-label=""> is announced as
    // an image with no description, which is the bug this replaced.
    const svg = plantSvg("budding", "stressed", { decorative: true });
    assert.match(svg, /aria-hidden="true"/);
    assert.doesNotMatch(svg, /role="img"/);
    assert.doesNotMatch(svg, /aria-label=/);
  });

  test("test_plant_decorativeUse_isNotFocusable", () => {
    // An SVG is focusable in some browsers, so a decorative one becomes a tab
    // stop that announces nothing.
    assert.match(plantSvg("seed", "steady", { decorative: true }), /focusable="false"/);
  });

  test("test_plant_neverEmitsAnEmptyLabel", () => {
    for (const stage of STAGES) {
      for (const vitality of VITALITIES) {
        for (const decorative of [true, false]) {
          assert.doesNotMatch(plantSvg(stage, vitality, { decorative }), /aria-label=""/);
        }
      }
    }
  });
});

describe("sizing", () => {
  test("test_plant_sizeIsHonoured", () => {
    assert.match(plantSvg("seed", "steady", { size: 96 }), /width="96"/);
  });

  test("test_plant_keepsItsAspectRatio", () => {
    // The viewBox is 200x240, so a square width and height would squash it.
    const svg = plantSvg("seed", "steady", { size: 100 });
    assert.match(svg, /width="100"/);
    assert.match(svg, /height="120"/);
    assert.match(svg, /viewBox="0 0 200 240"/);
  });

  test("test_plant_carriesItsVitalityAsAClass", () => {
    // The stylesheet colours the widget's frame from this.
    assert.match(plantSvg("seed", "wilting"), /plant-vitality-wilting/);
  });
});

describe("what the drawing says about health", () => {
  test("test_plant_wiltingDropsLeavesAndThrivingDoesNot", () => {
    assert.match(plantSvg("budding", "wilting"), /plant-fallen|fallen/i);
    const thriving = plantSvg("budding", "thriving");
    assert.doesNotMatch(thriving, /plant-fallen/);
  });

  test("test_plant_aSeedNeverDropsLeaves", () => {
    // It has none. Drawing fallen leaves under a seed is a picture of a
    // failure that cannot have happened yet, on the account most likely to be
    // discouraged by one.
    const svg = plantSvg("seed", "wilting");
    assert.doesNotMatch(svg, /plant-fallen/);
  });
});

describe("every call site agrees with the contract", () => {
  const sources = ["chrome.js", "session-view.js"].map((f) =>
    [f, readFileSync(fileURLToPath(new URL(`../js/${f}`, import.meta.url)), "utf8")]);

  test("test_plant_atMostOnePlantPerFileIsAnnounced", () => {
    // Six call sites draw a plant: the dashboard card, the growth-path strip,
    // the corner widget, its live update, the session summary. Exactly one of
    // them is the subject of its page; the rest sit beside text that already
    // says what they are. Two announcements of "Practice plant, budding,
    // stressed" on one screen is the noise the decorative flag exists to
    // prevent.
    for (const [file, src] of sources) {
      const calls = src.match(/plantSvg\([^)]*\)/g) || [];
      const announced = calls.filter((c) => !/decorative: true/.test(c));
      assert.ok(announced.length <= 1,
        `${file} announces ${announced.length} plants: ${announced.join(" | ")}`);
    }
  });

  test("test_plant_theGrowthPathStripIsNeverAnnounced", () => {
    // Seven stages in a row, each announcing itself, is the worst case.
    const chrome = sources.find(([f]) => f === "chrome.js")[1];
    const strip = chrome.slice(chrome.indexOf("function growthPathHtml"));
    const call = /plantSvg\([^)]*\)/.exec(strip.slice(0, 1200));
    assert.ok(call, "growthPathHtml no longer draws a plant");
    assert.match(call[0], /decorative: true/);
  });
});
