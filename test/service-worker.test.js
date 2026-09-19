// Checks that the service worker's precache list matches what the app actually
// loads at startup.
//
// The list is hand-maintained, and drift is invisible: everything works online,
// because the fetch handler caches whatever is requested. It only shows up when
// someone opens the app offline for the first time and a module is missing —
// which is a blank page, at the worst possible moment. Three modules had
// already gone missing this way before this test existed.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SW = read("../sw.js");

/** Paths listed in the SHELL array. */
function precachedPaths() {
  const block = SW.slice(SW.indexOf("const SHELL = ["), SW.indexOf("];"));
  return new Set([...block.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]));
}

/** Every module reachable from app.js by static import. */
function staticModuleGraph() {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = read(`../js/${file}`);
    for (const m of src.matchAll(/^import\s[^;]*?from\s+"\.\/([\w.-]+)"/gms)) walk(m[1]);
  };
  walk("app.js");
  return seen;
}

/** Modules pulled in only by a dynamic import(). */
function dynamicallyImported() {
  const out = new Set();
  for (const file of readdirSync(fileURLToPath(new URL("../js", import.meta.url)))) {
    if (!file.endsWith(".js")) continue;
    for (const m of read(`../js/${file}`).matchAll(/import\(\s*"\.\/([\w.-]+)"/g)) out.add(m[1]);
  }
  return out;
}

describe("service worker precache", () => {
  test("test_precache_coversEveryModuleLoadedAtStartup", () => {
    const precached = precachedPaths();
    const missing = [...staticModuleGraph()].filter((f) => !precached.has(`js/${f}`));
    assert.deepEqual(missing, [],
      `these load at startup but aren't precached, so a first offline visit would fail: ${missing.join(", ")}`);
  });

  test("test_precache_includesTheAppShellItself", () => {
    const precached = precachedPaths();
    for (const essential of ["index.html", "styles.css", "manifest.json"]) {
      assert.ok(precached.has(essential), `${essential} is missing from the precache`);
    }
  });

  test("test_precache_omitsLazilyLoadedModules", () => {
    // Precaching a dynamic import defeats the point of making it dynamic —
    // the bytes come back on the first visit for a screen that may never open.
    const precached = precachedPaths();
    const staticGraph = staticModuleGraph();
    for (const file of dynamicallyImported()) {
      if (staticGraph.has(file)) continue; // also reached statically, so it must be precached
      assert.ok(!precached.has(`js/${file}`),
        `${file} is loaded on demand but still precached, so first visits pay for it anyway`);
    }
  });

  test("test_precache_hasNoEntriesForFilesThatDoNotExist", () => {
    const onDisk = new Set(readdirSync(fileURLToPath(new URL("../js", import.meta.url))).map((f) => `js/${f}`));
    for (const path of precachedPaths()) {
      if (!path.startsWith("js/")) continue;
      assert.ok(onDisk.has(path), `precache lists ${path}, which no longer exists`);
    }
  });

  test("test_serviceWorker_cacheNameIsVersioned", () => {
    // The activate handler deletes every cache whose name doesn't match, so an
    // unchanged name after a shape change leaves stale entries in place.
    assert.match(SW, /const CACHE = "ledger-shell-v\d+";/);
  });
});
