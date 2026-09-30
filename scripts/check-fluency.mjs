// Compiles and runs every answer in the fluency drill, in every language.
//
//   node scripts/check-fluency.mjs
//
// Where this fits: beside the other checks, but not in `npm run check`,
// because it needs python3, node, javac and a C++ compiler on the machine,
// and a check that fails for want of a JDK teaches people to skip checks.
// Any language whose toolchain is missing is reported and skipped.
//
// Why it exists: the drill is only worth anything if its answers are right. A
// card that teaches a Java comparator that overflows, or a C++ heap that is
// secretly a max-heap, is worse than no card — and "looks right" is exactly
// the standard those bugs pass. So each answer is run, and the ones whose
// failure would be subtle rather than a compile error carry an assertion.
//
// The answers use `...` to mean "your code here". That is legal Python and
// nothing else, so for the other languages the harness replaces it with an
// empty statement before compiling.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FLUENCY_CARDS } from "../js/fluency.js";

/** What each card's snippet expects to already exist, and what must be true
 *  after it runs. */
const H = {
  "freq-map": {
    python: ['s = "aab"', 'assert count["a"] == 2 and count["b"] == 1'],
    java: ['String s = "aab";', 'check(count.get(\'a\') == 2 && count.get(\'b\') == 1);'],
    cpp: ['string s = "aab";', 'check(count[\'a\'] == 2 && count[\'b\'] == 1);'],
    javascript: ['const s = "aab";', 'check(count.get("a") === 2 && count.get("b") === 1);'],
  },
  "sort-pairs": {
    python: ["pairs = [[1, 2], [3, 1], [2, 2]]", "assert pairs == [[3, 1], [2, 2], [1, 2]]"],
    java: ["int[][] pairs = {{1, 2}, {3, 1}, {2, 2}};", "check(pairs[0][0] == 3 && pairs[1][0] == 2 && pairs[2][0] == 1);"],
    cpp: ["vector<vector<int>> pairs = {{1, 2}, {3, 1}, {2, 2}};", "check(pairs[0][0] == 3 && pairs[1][0] == 2 && pairs[2][0] == 1);"],
    javascript: ["const pairs = [[1, 2], [3, 1], [2, 2]];", "check(pairs[0][0] === 3 && pairs[1][0] === 2 && pairs[2][0] === 1);"],
  },
  "min-heap": {
    python: ["dist, node = 5, 1", "assert (d, u) == (5, 1)"],
    java: ["int dist = 5, node = 1;", "check(top[0] == 5 && top[1] == 1);"],
    cpp: ["int dist = 5, node = 1;", "check(d == 5 && u == 1);"],
    // The JS answer is a class; prove it is a *min*-heap, in order.
    javascript: ["", "const h = new MinHeap(); for (const x of [5, 1, 4, 2, 3]) h.push([x, 0]); const out = []; while (h.size) out.push(h.pop()[0]); check(out.join() === \"1,2,3,4,5\");"],
  },
  "bfs-queue": {
    python: ["start = 0", ""], java: ["int start = 0;", ""],
    cpp: ["int start = 0;", ""], javascript: ["const start = 0;", ""],
  },
  grid: {
    python: ["m, n = 2, 3", "seen[0][0] = True\nassert seen[1][0] is False"],
    java: ["int m = 2, n = 3;", "seen[0][0] = true; check(!seen[1][0]);"],
    cpp: ["int m = 2, n = 3;", "seen[0][0] = true; check(!seen[1][0]);"],
    javascript: ["const m = 2, n = 3;", "seen[0][0] = true; check(seen[1][0] === false);"],
  },
  neighbours: {
    python: ["r, c, m, n = 0, 0, 2, 2", ""], java: ["int r = 0, c = 0, m = 2, n = 2;", ""],
    cpp: ["int r = 0, c = 0, m = 2, n = 2;", ""], javascript: ["const r = 0, c = 0, m = 2, n = 2;", ""],
  },
  "lower-bound": {
    python: ["a, target = [1, 2, 2, 3], 2", "assert i == 1"],
    java: ["int[] a = {1, 2, 2, 3}; int target = 2;", "check(lo == 1);"],
    cpp: ["vector<int> a = {1, 2, 2, 3}; int target = 2;", "check(i == 1);"],
    javascript: ["const a = [1, 2, 2, 3], target = 2;", "check(lo === 1);"],
  },
  "map-entries": {
    python: ['counts = {"a": 1}', ""],
    java: ['Map<String, Integer> counts = new HashMap<>(); counts.put("a", 1);', ""],
    cpp: ['map<string, int> counts = {{"a", 1}};', ""],
    javascript: ['const counts = new Map([["a", 1]]);', ""],
  },
  "build-string": {
    python: ["items = [1, 2]", 'assert result == "12"'],
    java: ["int[] items = {1, 2};", 'check(result.equals("12"));'],
    cpp: ["vector<int> items = {1, 2};", 'check(result == "12");'],
    javascript: ["const items = [1, 2];", 'check(result === "12");'],
  },
  infinity: {
    python: ["", "assert best > 10**18"], java: ["", "check(best > 1000000);"],
    cpp: ["", "check(best > 1000000);"], javascript: ["", "check(best > 1e300);"],
  },
  adjacency: {
    python: ["n, edges = 3, [[0, 1], [1, 2]]", "assert graph[1] == [0, 2]"],
    java: ["int n = 3; int[][] edges = {{0, 1}, {1, 2}};", "check(graph.get(1).size() == 2);"],
    cpp: ["int n = 3; vector<vector<int>> edges = {{0, 1}, {1, 2}};", "check(graph[1].size() == 2);"],
    javascript: ["const n = 3, edges = [[0, 1], [1, 2]];", "check(graph[1].join() === \"0,2\");"],
  },
  "anagram-key": {
    python: ['s = "bca"', 'assert key == "abc"'], java: ['String s = "bca";', 'check(key.equals("abc"));'],
    cpp: ['string s = "bca";', 'check(key == "abc");'], javascript: ['const s = "bca";', 'check(key === "abc");'],
  },
  "prefix-sums": {
    python: ["nums = [1, 2, 3]", "assert prefix[3] - prefix[1] == 5"],
    java: ["int[] nums = {1, 2, 3}; int n = nums.length;", "check(prefix[3] - prefix[1] == 5);"],
    cpp: ["vector<int> nums = {1, 2, 3}; int n = nums.size();", "check(prefix[3] - prefix[1] == 5);"],
    javascript: ["const nums = [1, 2, 3];", "check(prefix[3] - prefix[1] === 5);"],
  },
  "char-index": {
    python: ['c = "c"', 'assert i == 2 and ch == "c"'],
    java: ["char c = 'c';", "check(i == 2 && ch == 'c');"],
    cpp: ["char c = 'c';", "check(i == 2 && ch == 'c');"],
    javascript: ['const c = "c";', 'check(i === 2 && ch === "c");'],
  },
  "copy-list": {
    python: ["results, path = [], [1]", "path.clear()\nassert results == [[1]]"],
    java: ["List<List<Integer>> results = new ArrayList<>(); List<Integer> path = new ArrayList<>(List.of(1));", "path.clear(); check(results.get(0).size() == 1);"],
    cpp: ["vector<vector<int>> results; vector<int> path = {1};", "path.clear(); check(results[0].size() == 1);"],
    javascript: ["const results = [], path = [1];", "path.length = 0; check(results[0].length === 1);"],
  },
};

/** The one card made of expressions rather than statements. Its lines are
 *  printed and the output compared, because the *values* are the lesson. */
const MOD_EXPECT = { python: ["-4", "1", "4"], java: ["-3", "-1", "4"], cpp: ["-3", "-1", "4"], javascript: ["-3", "-1", "4"] };

const stripComment = (line, lang) => line.split(lang === "python" ? "#" : "//")[0].trim();
const placeholders = (code) => code.replace(/\{\s*\.\.\.\s*\}/g, "{ }").replace(/^\s*\.\.\.\s*$/gm, ";");

function snippet(card, lang) {
  const code = card.answers[lang];
  if (card.id !== "negative-mod") return lang === "python" ? code : placeholders(code);
  const exprs = code.split("\n").map((l) => stripComment(l, lang)).filter(Boolean);
  const print = { python: (e) => `print(${e})`, java: (e) => `System.out.println(${e});`,
    cpp: (e) => `cout << (${e}) << "\\n";`, javascript: (e) => `console.log(String(${e}));` }[lang];
  const pre = { python: "i, n = -1, 5", java: "int i = -1, n = 5;", cpp: "int i = -1, n = 5;", javascript: "const i = -1, n = 5;" }[lang];
  return [pre, ...exprs.map(print)].join("\n");
}

const dir = mkdtempSync(join(tmpdir(), "fluency-"));
const failures = [];
const skipped = [];
const have = (cmd) => { try { execFileSync("which", [cmd], { stdio: "ignore" }); return true; } catch { return false; } };

function runLanguage(lang, build) {
  for (const card of FLUENCY_CARDS) {
    if (!card.answers[lang]) { failures.push(`${card.id}: no ${lang} answer`); continue; }
    const [pre, post] = card.id === "negative-mod" ? ["", ""] : (H[card.id]?.[lang] || ["", ""]);
    try {
      const out = build(pre, snippet(card, lang), post, card.id);
      if (card.id === "negative-mod") {
        const got = out.trim().split(/\s+/);
        if (got.join() !== MOD_EXPECT[lang].join()) failures.push(`negative-mod [${lang}]: printed ${got.join(", ")}, the card says ${MOD_EXPECT[lang].join(", ")}`);
      }
    } catch (err) {
      failures.push(`${card.id} [${lang}]: ${String(err.stderr || err.stdout || err.message).trim().split("\n").slice(0, 4).join(" | ")}`);
    }
  }
}

/** A Python that actually runs. "python3 is on the PATH" is not the same
 *  thing: a stale framework install can be first on it and fail to load at
 *  all, which would report every Python card as wrong. $PYTHON wins if set. */
function workingPython() {
  for (const cmd of [process.env.PYTHON, "python3", "python"].filter(Boolean)) {
    try {
      execFileSync(cmd, ["-c", "import sys; assert sys.version_info >= (3, 8)"], { stdio: "ignore" });
      return cmd;
    } catch { /* try the next */ }
  }
  return null;
}

const python = workingPython();
if (python) {
  runLanguage("python", (pre, code, post) => {
    const file = join(dir, "c.py");
    writeFileSync(file, [pre, code, post].join("\n"));
    return execFileSync(python, [file], { encoding: "utf8", stdio: "pipe" });
  });
} else skipped.push("python (none that runs; set $PYTHON)");

runLanguage("javascript", (pre, code, post) => {
  const file = join(dir, "c.mjs");
  writeFileSync(file, `const check = (ok) => { if (!ok) throw new Error("assertion failed"); };\n${pre}\n${code}\n${post}\n`);
  return execFileSync("node", [file], { encoding: "utf8", stdio: "pipe" });
});

if (have("javac") && have("java")) {
  runLanguage("java", (pre, code, post) => {
    const src = `import java.util.*;\npublic class C {\n  static void check(boolean ok) { if (!ok) throw new AssertionError("assertion failed"); }\n  public static void main(String[] args) {\n${pre}\n${code}\n${post}\n  }\n}\n`;
    writeFileSync(join(dir, "C.java"), src);
    execFileSync("javac", ["-d", dir, join(dir, "C.java")], { stdio: "pipe" });
    return execFileSync("java", ["-cp", dir, "C"], { encoding: "utf8", stdio: "pipe" });
  });
} else skipped.push("java");

const cxx = have("g++") ? "g++" : have("clang++") ? "clang++" : null;
if (cxx) {
  runLanguage("cpp", (pre, code, post) => {
    const includes = ["vector", "queue", "unordered_map", "map", "string", "algorithm", "climits", "limits", "iostream", "utility", "functional", "stdexcept"];
    const src = `${includes.map((h) => `#include <${h}>`).join("\n")}\nusing namespace std;\nstatic void check(bool ok) { if (!ok) throw runtime_error("assertion failed"); }\nint main() {\n${pre}\n${code}\n${post}\nreturn 0;\n}\n`;
    writeFileSync(join(dir, "c.cpp"), src);
    execFileSync(cxx, ["-std=c++17", "-o", join(dir, "c.out"), join(dir, "c.cpp")], { stdio: "pipe" });
    return execFileSync(join(dir, "c.out"), { encoding: "utf8", stdio: "pipe" });
  });
} else skipped.push("cpp");

rmSync(dir, { recursive: true, force: true });

if (skipped.length) console.log(`skipped, no toolchain: ${skipped.join(", ")}`);
if (failures.length) {
  for (const f of failures) console.error(f);
  console.error(`\n${failures.length} answer${failures.length === 1 ? "" : "s"} in the fluency drill would teach something wrong.`);
  process.exit(1);
}
console.log(`every fluency answer compiles, runs and holds (${FLUENCY_CARDS.length} cards)`);
