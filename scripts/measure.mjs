// Answers the two questions everyone guesses about instead of checking.
//
//   node scripts/measure.mjs
//
//   1. Is it slow?           — how long the read paths a render depends on take
//   2. How big does it get?  — where a realistic log crosses GitHub's 1 MB
//                              single-file limit, and what is taking the room
//
// Not part of `npm run check`: nothing here passes or fails, and a benchmark
// that gates a commit becomes a flaky test on a shared machine. It is here so
// the answers are one command rather than a throwaway script, which is what
// they were the first two times someone wanted them.
//
// What it found, on the day it was written — worth comparing against, not
// worth trusting once the shapes below stop resembling a real log:
//
//   * 6,400 attempts cost about 18 ms of logic per dashboard render, and 1,800
//     — which is where the size wall is — cost about 5. There is no
//     performance problem to solve, and having profiled is the reason to
//     believe that rather than an opinion about it.
//   * A realistic log fits at 300 problems / 1,800 attempts (97% of the limit)
//     and is over at 400 / 3,200. Two or three years of steady practice, and a
//     hard wall when it arrives rather than a slope.
//   * Attempts are 80% of the file at that point. Inside them the repeated
//     JSON key names are 22% of the whole file — more than the saved code at
//     21%, and more than what you actually wrote at 15%. Problem statements,
//     which the size warning used to blame first, are 7%.

import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const JS = join(dirname(fileURLToPath(import.meta.url)), "..", "js");
const load = (f) => import(pathToFileURL(join(JS, f)));

const { buildSeedState } = await load("seed.js");
const logic = await load("logic.js");
const stats = await load("stats.js");

const encoder = new TextEncoder();
const bytes = (v) => encoder.encode(JSON.stringify(v ?? null)).length;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// A statement and a solution of the size people actually paste.
const STATEMENT = "Given an array of integers nums and an integer target, return indices "
  + "of the two numbers such that they add up to target. ".repeat(4);
const CODE = `class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for i, n in enumerate(nums):
            if target - n in seen:
                return [seen[target - n], i]
            seen[n] = i
        return []
`;

/**
 * A log shaped like a real one rather than like a minimal fixture.
 *
 * The proportions matter more than the totals: most problems collect a
 * statement, about half the attempts keep their code, and every attempt
 * carries a sentence. A fixture with empty strings measures the schema and
 * tells you nothing about the wall.
 */
function realisticLog(problems, attemptsEach, { withCode = 0.5, withStatement = 0.8 } = {}) {
  const state = buildSeedState();
  const today = logic.todayISO();
  const patterns = state.patterns.map((p) => p.id);
  state.problems = Array.from({ length: problems }, (_, i) => ({
    id: `a-reasonably-long-problem-name-${i}`,
    name: `A Reasonably Long Problem Name ${i}`,
    number: 1000 + i, difficulty: "Medium", patternId: patterns[i % patterns.length],
    status: logic.STATUS_ACTIVE, box: i % 5,
    nextReviewDate: logic.addDaysISO(today, -(i % 40)),
    catalogSlug: `a-reasonably-long-problem-name-${i}`,
    url: `https://leetcode.com/problems/a-reasonably-long-problem-name-${i}/`,
    approach: "", filePath: "", notes: "",
    statement: i / problems < withStatement ? STATEMENT : "",
    statementMeta: { source: "leetcode", at: today },
    attempts: Array.from({ length: attemptsEach }, (_, j) => ({
      id: `a-reasonably-long-problem-name-${i}-attempt-${j}`,
      date: logic.addDaysISO(today, -(j * 5)),
      outcome: j % 3 === 0 ? "solved-clean" : "solved-struggled",
      patternGuess: j % 2 ? "correct" : "incorrect",
      timeToInsightMin: 8, timeToSolveMin: 32,
      mistakeTags: ["off-by-one", "edge-case-missed"],
      soulStatement: "I kept trying to track counts in a dict but never shrank the window from the left.",
      ...(j / attemptsEach < withCode ? { code: CODE, codeLang: "python" } : {}),
    })),
  }));
  return state;
}

function timed(fn, runs = 20) {
  fn();                                   // warm, so the first call's compile isn't the measurement
  const started = process.hrtime.bigint();
  for (let i = 0; i < runs; i++) fn();
  return Number(process.hrtime.bigint() - started) / 1e6 / runs;
}

console.log("\n=== Is it slow? ===");
console.log("Milliseconds per call, for the reads a dashboard render depends on.\n");
const paths = [
  ["allAttempts", (s) => logic.allAttempts(s)],
  ["patternStats", (s) => logic.patternStats(s)],
  ["recommendSession", (s) => logic.recommendSession(s)],
  ["computePlantState", (s) => logic.computePlantState(s)],
  ["planToday", (s) => logic.planToday(s)],
  ["progressSummary", (s) => stats.progressSummary(s)],
  ["weekInReview", (s) => stats.weekInReview(s)],
];
const sizes = [[30, 2], [150, 4], [400, 6], [800, 8]];
// Built once per size. Building it inside the timed loop measures how long it
// takes to make a fake log, which is nobody's question — and the first version
// of this script did exactly that and reported numbers five times too high.
const logs = sizes.map(([p, a]) => realisticLog(p, a));
console.log(`${"".padEnd(20)}${sizes.map(([p, a]) => `${p * a}`.padStart(9)).join("")}   attempts`);
for (const [label, fn] of paths) {
  const row = logs.map((log) => timed(() => fn(log)).toFixed(2).padStart(9));
  console.log(`${label.padEnd(20)}${row.join("")}`);
}
const dashboard = logs.map((log) => timed(() => {
  logic.computePlantState(log);
  logic.recommendSession(log);
  logic.planToday(log);
  logic.patternStats(log);
}).toFixed(1).padStart(9));
console.log(`${"one dashboard".padEnd(20)}${dashboard.join("")}`);

console.log("\n=== How big does it get? ===");
console.log(`GitHub refuses a single file over ${kb(logic.SYNC_LIMIT_BYTES)}.\n`);
console.log("problems  attempts     size   of limit");
let wall = null;
let lastUnder = null;
for (const [p, a] of [[50, 3], [100, 4], [200, 5], [300, 6], [400, 8], [600, 10]]) {
  const f = logic.syncFootprint(realisticLog(p, a));
  if (!wall && f.over) wall = [p, a];
  if (!f.over) lastUnder = [p, a];
  console.log(`${String(p).padStart(8)}${String(p * a).padStart(10)}${kb(f.total).padStart(9)}`
    + `${`${(f.fraction * 100).toFixed(0)}%`.padStart(11)}${f.over ? "   over" : ""}`);
}
console.log(wall
  ? `\nFits at ${lastUnder[0]} problems / ${lastUnder[0] * lastUnder[1]} attempts; `
    + `over at ${wall[0]} / ${wall[0] * wall[1]}.`
  : "\nNever crosses the limit at the sizes tried.");

console.log("\n=== What is taking the room, at the limit? ===\n");
const atLimit = realisticLog(300, 6);
const attempts = atLimit.problems.flatMap((p) => p.attempts);
const total = bytes(atLimit);
const sum = (fn) => attempts.reduce((n, a) => n + fn(a), 0);
const FIELDS = ["id", "date", "outcome", "patternGuess", "timeToInsightMin",
  "timeToSolveMin", "mistakeTags", "soulStatement", "code", "codeLang"];
const rows = [
  ["attempts, all of them", bytes(attempts)],
  ["  saved code", sum((a) => (a.code ? bytes(a.code) : 0))],
  ["  JSON key names", sum((a) => FIELDS.filter((k) => k in a).reduce((n, k) => n + k.length + 4, 0) + 2)],
  ["  what you wrote", sum((a) => bytes(a.soulStatement))],
  ["  mistake tags", sum((a) => bytes(a.mistakeTags))],
  ["  attempt ids", sum((a) => bytes(a.id))],
  ["problem statements", atLimit.problems.reduce((n, p) => n + bytes(p.statement || ""), 0)],
  ["everything else", bytes(atLimit.problems.map(({ attempts: _a, statement: _s, ...rest }) => rest))],
];
for (const [label, n] of rows) {
  console.log(`${label.padEnd(26)}${kb(n).padStart(8)}${`${(n / total * 100).toFixed(0)}%`.padStart(6)}`);
}
console.log(`\n${attempts.length} attempts, ${(bytes(attempts) / attempts.length).toFixed(0)} bytes each.`);
process.exit(0);
