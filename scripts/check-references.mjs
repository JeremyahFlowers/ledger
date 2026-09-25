// Finds names a module uses but never imports.
//
//   node scripts/check-references.mjs
//
// Why this exists, when check-modules.mjs already loads every module: loading
// only proves the import statements resolve. A function referenced inside a
// render body that nobody imported is perfectly loadable — it throws the first
// time that page is opened, which for a view nobody opens during a test run is
// the first time a user opens it.
//
// That is not hypothetical. Splitting views.js moved `OUTCOME_GLYPH` into two
// new files and left it out of both import lists. The module check passed, all
// 577 unit tests passed, and the Journal page threw on open.
//
// This is a heuristic, not a parser, and it is tuned to stay quiet: a name is
// only reported when some module in this project exports it. A typo or a real
// global is never flagged, which is fine — those fail loudly and immediately.
// The one failure mode it exists to catch is a symbol that used to be in scope
// and silently stopped being.

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const JS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "js");

/**
 * Comments out, so prose is never mistaken for a reference.
 *
 * String and template bodies deliberately stay in. An earlier version stripped
 * them too, and a single unbalanced backtick — easy to produce in a file that
 * is mostly HTML in template literals — desynchronised the matcher and
 * swallowed four hundred lines of real code, including the exact missing
 * reference this script had been written to find. It reported all clear.
 *
 * Leaving strings in risks the opposite error: a symbol name appearing as
 * prose inside some rendered copy. That is a false positive a human resolves
 * in seconds, where the other kind is silence.
 */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

function matchAll(src, re) {
  return new Set([...src.matchAll(re)].map((m) => m[1]));
}

function declaredIn(src) {
  const names = new Set([
    ...matchAll(src, /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g),
    ...matchAll(src, /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g),
    ...matchAll(src, /\bclass\s+([A-Za-z_$][\w$]*)/g),
    ...matchAll(src, /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g),
    ...matchAll(src, /(?:^|[(,\s])([A-Za-z_$][\w$]*)\s*=>/gm),
  ]);
  const addBindings = (text) => {
    for (let part of text.split(",")) {
      part = part.trim();
      if (part.includes(":")) part = part.slice(part.indexOf(":") + 1);
      if (part.includes("=")) part = part.slice(0, part.indexOf("="));
      const m = /^\.{0,3}([A-Za-z_$][\w$]*)/.exec(part.trim());
      if (m) names.add(m[1]);
    }
  };
  for (const m of src.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/g)) addBindings(m[1]);
  for (const m of src.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) addBindings(m[1].replace(/[{}[\]]/g, ","));
  return names;
}

/** Names a module re-exports from elsewhere: `export { a, b } from "./x.js"`.
 *  They are in scope for the module's consumers without being in scope for its
 *  own body, so they are neither imports nor local — but they are also not
 *  references, and reading them as such made logic.js look like it used ten
 *  things it had only forwarded. */
function reExportedIn(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(",")) {
      const name = part.includes(" as ") ? part.split(" as ")[0] : part;
      if (name.trim()) names.add(name.trim());
    }
  }
  return names;
}

function importedIn(src) {
  const names = new Set([
    ...matchAll(src, /import\s+([A-Za-z_$][\w$]*)\s+from/g),
    ...matchAll(src, /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g),
  ]);
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(",")) {
      const name = part.includes(" as ") ? part.split(" as ")[1] : part;
      if (name.trim()) names.add(name.trim());
    }
  }
  return names;
}

function exportedIn(src) {
  const names = matchAll(src, /^export\s+(?:async\s+)?(?:function\s*\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.includes(" as ") ? part.split(" as ")[1] : part;
      if (name.trim()) names.add(name.trim());
    }
  }
  return names;
}

// Anything reachable without importing it. Not exhaustive — it does not need
// to be, because a name is only ever reported if this project exports it.
const AMBIENT = new Set(`
await async function return const let var if else for while do switch case break continue new
typeof instanceof this null true false undefined NaN Infinity class extends super try catch finally
throw of in delete void yield import export default from as static get set
Object Array String Number Boolean Math JSON Date RegExp Map Set WeakMap WeakSet Promise Proxy Reflect
Error TypeError RangeError SyntaxError Symbol BigInt Intl URL URLSearchParams Blob File FileReader
FormData Headers Request Response AbortController CustomEvent Event EventTarget DOMParser CSS
TextEncoder TextDecoder Uint8Array ArrayBuffer Int32Array Float64Array
console window document navigator localStorage sessionStorage location history fetch caches indexedDB
setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame
queueMicrotask structuredClone atob btoa alert confirm prompt performance crypto globalThis self
matchMedia getComputedStyle isNaN isFinite parseInt parseFloat encodeURIComponent decodeURIComponent
Node Element HTMLElement HTMLAnchorElement SVGElement Image MutationObserver ResizeObserver
IntersectionObserver
`.trim().split(/\s+/));

const files = readdirSync(JS_DIR).filter((f) => f.endsWith(".js"));
const sources = new Map(files.map((f) => [f, readFileSync(join(JS_DIR, f), "utf8")]));
const exportsByFile = new Map([...sources].map(([f, src]) => [f, exportedIn(src)]));

const problems = [];
for (const [file, src] of sources) {
  const code = strip(src);
  const known = new Set([...declaredIn(code), ...importedIn(src), ...reExportedIn(src), ...AMBIENT]);
  const used = new Set([
    ...matchAll(code, /(?<![.\w$])([A-Za-z_$][\w$]*)\s*(?=\()/g),   // calls
    ...matchAll(code, /\$\{\s*([A-Za-z_$][\w$]*)/g),                // template holes
    ...matchAll(code, /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\[/g),       // table lookups
    ...matchAll(code, /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\./g),       // member reads
    // A bare reference passed as an argument: `filter(isCleanSolve)`. Missed
    // until it shipped twice — `isCleanSolve` went unimported in two files and
    // this said all clear, because nothing here was followed by a `(`.
    ...matchAll(code, /[(,]\s*([A-Za-z_$][\w$]*)\s*[),]/g),
  ]);
  for (const name of [...used].sort()) {
    if (known.has(name)) continue;
    const homes = [...exportsByFile].filter(([f, ex]) => f !== file && ex.has(name)).map(([f]) => f);
    if (homes.length) problems.push({ file, name, homes });
  }
}

if (problems.length) {
  for (const { file, name, homes } of problems) {
    console.error(`${file}: uses ${name}, which is exported by ${homes.join(", ")} — but never imports it.`);
  }
  console.error("\nThis throws the first time that view is opened.");
  process.exit(1);
}
console.log(`no unresolved references across ${files.length} modules`);
