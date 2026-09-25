// Finds class names the app renders that the stylesheet never defines.
//
//   node scripts/check-styles.mjs
//
// Why this exists: a view that names a class nobody styled renders, passes
// every test, and looks wrong. Nothing else in this project catches that — the
// module check loads it, the reference check resolves its imports, the view
// smoke test calls its render, and all three are happy with an unstyled div.
//
// It happened: the design session wrapped itself in `ws-shell` when the class
// that pins a session to the viewport is `ws`. The session rendered, every one
// of 1,061 tests passed, and the layout was wrong the first time anyone opened
// it.
//
// Heuristic, and tuned to stay quiet. Only literal class names are checked —
// anything built from an expression is skipped rather than guessed at — and a
// name is only reported when the stylesheet defines no rule for it at all.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const css = readFileSync(join(ROOT, "styles.css"), "utf8");
const defined = new Set([...css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]));

/**
 * Class names this file renders, from literal `class="…"` attributes.
 *
 * Scanned rather than matched with a regex, because a class attribute
 * routinely contains a template hole that contains its own quotes —
 * `class="tab ${id === current ? "active" : ""}"` — and `class="[^"]*"` stops
 * at the first inner quote, reporting the tail of an expression as a class
 * name. The first version did exactly that and produced five false hits out
 * of nine.
 *
 * A run of literal text that is cut short by a hole is skipped: `hl-${level}`
 * is a prefix, not a class.
 */
function classesIn(src) {
  const found = new Set();
  const attr = /class="/g;
  let m;
  while ((m = attr.exec(src))) {
    let i = m.index + m[0].length;
    let run = "";
    const runs = [];
    let truncated = false;
    while (i < src.length) {
      if (src[i] === '"') break;
      if (src.startsWith("${", i)) {
        // Skip the hole, counting braces so a nested object literal inside it
        // does not end it early.
        runs.push({ text: run, cutShort: !/\s$/.test(run) && run !== "" });
        run = "";
        truncated = true;
        let depth = 0;
        i += 1;
        do {
          if (src[i] === "{") depth += 1;
          else if (src[i] === "}") depth -= 1;
          i += 1;
        } while (i < src.length && depth > 0);
        continue;
      }
      run += src[i];
      i += 1;
    }
    runs.push({ text: run, cutShort: false });

    for (let r = 0; r < runs.length; r++) {
      const parts = runs[r].text.split(/\s+/);
      parts.forEach((cls, idx) => {
        // The first token of a run that follows a hole may be its tail
        // (`${x}-suffix`), and the last token of a run cut short by a hole may
        // be its prefix (`hl-${level}`). Neither is a whole class name.
        const followsHole = r > 0 && idx === 0 && !/^\s/.test(runs[r].text);
        const precedesHole = runs[r].cutShort && idx === parts.length - 1;
        if (!cls || followsHole || precedesHole) return;
        if (/^[a-z][\w-]*$/i.test(cls)) found.add(cls);
      });
    }
    void truncated;
  }
  return found;
}

const files = [
  ...readdirSync(join(ROOT, "js")).filter((f) => f.endsWith(".js")).map((f) => join("js", f)),
  "index.html", "interview.html",
];

const problems = [];
for (const file of files) {
  for (const cls of classesIn(readFileSync(join(ROOT, file), "utf8"))) {
    if (!defined.has(cls)) problems.push({ file, cls });
  }
}

if (problems.length) {
  for (const { file, cls } of problems) {
    console.error(`${file}: renders class "${cls}", which styles.css never defines.`);
  }
  console.error("\nThis renders, passes every test, and looks wrong.");
  process.exit(1);
}
console.log(`every rendered class is styled (${defined.size} defined)`);
