// Practising a pattern from its topic page (js/topic-practice.js).
//
// "If there's topics / patterns inside the coding section that I can learn but
// can't practise, what's the point?" The topic page listed only problems you
// had already logged, so nine patterns had nothing on them to do. These pin
// that every pattern has catalog material, that the ladder never offers what
// you already track, and that starting a rung gives you a real problem record.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ladderFor, adoptCatalogProblem, LADDER_PER_DIFFICULTY } from "../js/topic-practice.js";
import { patternWeight, PATTERN_CONFIDENCE } from "../js/catalog.js";
import { PATTERNS } from "../js/seed.js";
import { STATUS_BACKLOG } from "../js/logic.js";

const entry = (slug, over = {}) => ({
  slug, title: slug.toUpperCase(), number: 1, difficulty: "Medium", patterns: { dp: 1 }, ...over,
});

/** A store that applies mutations synchronously and records their messages. */
function makeStore(problems = []) {
  const store = {
    state: { problems },
    messages: [],
    mutate(fn, message) { fn(store.state); store.messages.push(message); },
  };
  return store;
}

describe("the ladder", () => {
  test("test_ladderFor_asksForEachDifficultyEasiestFirst", async () => {
    const asked = [];
    const find = async (patternId, { difficulty, limit }) => {
      asked.push([difficulty, limit]);
      return [entry(`${difficulty}-1`, { difficulty })];
    };
    const rungs = await ladderFor("dp", new Set(), find);
    assert.deepEqual(asked, Object.entries(LADDER_PER_DIFFICULTY));
    assert.deepEqual(rungs.map((r) => r.difficulty), ["Easy", "Medium", "Hard"]);
  });

  test("test_ladderFor_passesWhatYouOwnAsTheExclusion", async () => {
    const owned = new Set(["mine"]);
    let seen = null;
    await ladderFor("dp", owned, async (_, { exclude }) => { seen = exclude; return []; });
    assert.equal(seen, owned);
  });

  test("test_ladderFor_catalogFails_rejectsSoThePageCanSaySo", async () => {
    await assert.rejects(ladderFor("dp", new Set(), async () => { throw new Error("offline"); }));
  });
});

describe("taking a rung", () => {
  test("test_adoptCatalogProblem_new_addsItToTheBankUnderThisPattern", () => {
    const store = makeStore();
    const p = adoptCatalogProblem(store, entry("coin-change", { patterns: { "recursion-dp": 0.8 } }), "knapsack");
    assert.equal(store.state.problems.length, 1);
    assert.equal(p.status, STATUS_BACKLOG);
    assert.equal(p.patternId, "knapsack", "filed under the pattern whose page it came from");
    assert.equal(p.catalogSlug, "coin-change");
  });

  test("test_adoptCatalogProblem_alreadyTracked_returnsTheExistingRecord", () => {
    const mine = { id: "x", name: "Coin Change", catalogSlug: "coin-change", patternId: "recursion-dp", attempts: [] };
    const store = makeStore([mine]);
    assert.equal(adoptCatalogProblem(store, entry("coin-change"), "knapsack"), mine);
    assert.equal(store.messages.length, 0, "wrote a duplicate");
  });

  test("test_adoptCatalogProblem_trackedUnderTheSameTitle_isNotAddedTwice", () => {
    const store = makeStore([{ id: "x", name: "COIN-CHANGE", patternId: "dp", attempts: [] }]);
    adoptCatalogProblem(store, entry("coin-change"), "dp");
    assert.equal(store.state.problems.length, 1);
  });
});

describe("every pattern can be practised", () => {
  // Against the real catalog, because the failure this guards is in the data:
  // a pattern the taxonomy stops matching would quietly empty its page.
  const catalog = JSON.parse(readFileSync(fileURLToPath(new URL("../data/catalog.json", import.meta.url)), "utf8"));
  const MIN_PER_PATTERN = 8;

  for (const pat of PATTERNS) {
    test(`test_catalog_${pat.id}_hasEnoughToPractise`, () => {
      const n = catalog.problems.filter((p) => patternWeight(p, pat.id) >= PATTERN_CONFIDENCE).length;
      assert.ok(n >= MIN_PER_PATTERN, `${pat.name} has ${n} catalog problems`);
    });
  }
});
