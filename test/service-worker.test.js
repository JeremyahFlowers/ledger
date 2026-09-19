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
    // unchanged name after a shape change leaves stale entries in place. The
    // name now comes from the release version the worker was registered with
    // rather than a second number kept here — see test/version.test.js.
    assert.match(SW, /const CACHE = `ledger-shell-\$\{APP_VERSION\}`;/);
  });
});

describe("service worker freshness", () => {
  // GitHub Pages serves these assets with Cache-Control: max-age=600. A plain
  // fetch() inside the worker consults the browser's HTTP cache first, so for
  // ten minutes after a deploy the worker was handed the previous version and
  // then stored it — the exact stale-module state the network-first strategy
  // exists to prevent. Observed on a real deploy, not theorised.
  const sw = read("../sw.js");

  test("test_sw_fetchHandler_bypassesTheHttpCache", () => {
    assert.match(sw, /fetch\(event\.request,\s*\{\s*cache:\s*"no-cache"\s*\}\)/,
      "the fetch handler must revalidate, or network-first serves stale files");
  });

  test("test_sw_installPrecache_bypassesTheHttpCache", () => {
    assert.doesNotMatch(sw, /\bc\.add\(/,
      "cache.add() goes through the HTTP cache and can precache the previous deploy");
    assert.match(sw, /fetch\(path,\s*\{\s*cache:\s*"no-cache"\s*\}\)/);
  });

  test("test_sw_cacheIsInvalidatedByTheReleaseVersion", () => {
    // An old worker keeps serving its own cache until the cache name changes,
    // so a strategy fix that forgets to change it ships to nobody. This used
    // to be a hand-bumped integer in sw.js, which is exactly the kind of
    // second number that gets forgotten; the release version now drives it,
    // and any release necessarily changes it.
    assert.match(sw, /ledger-shell-\$\{APP_VERSION\}/);
    assert.match(sw, /searchParams\.get\("v"\)/);
  });
});
