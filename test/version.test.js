// Tests for the release version in js/version.js.
//
// The version does real work here beyond being a label: the service worker is
// registered as ./sw.js?v=<version> and names its cache after it, so the
// version is what invalidates the old cache and what makes the browser treat
// the worker as new and install it. A release that forgets to bump it is a
// release that reaches nobody — which is a failure mode with no symptom, since
// everything looks fine locally.
//
// These also refuse to let a version ship without a changelog entry.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { APP_VERSION, RELEASED } from "../js/version.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("version", () => {
  test("test_version_isSemver", () => {
    assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/, "major.minor.patch, no prefix or suffix");
  });

  test("test_released_isAnIsoDate", () => {
    assert.match(RELEASED, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!Number.isNaN(Date.parse(RELEASED)), `${RELEASED} is not a real date`);
  });

  test("test_version_isSafeInAUrl", () => {
    // It goes into the service worker's query string verbatim.
    assert.equal(encodeURIComponent(APP_VERSION), APP_VERSION);
  });
});

describe("version wiring", () => {
  test("test_serviceWorker_derivesItsCacheNameFromTheRegisteredVersion", () => {
    const sw = read("../sw.js");
    assert.match(sw, /searchParams\.get\("v"\)/,
      "the worker must read the version from its own URL");
    assert.doesNotMatch(sw, /const CACHE = "ledger-shell-v\d+"/,
      "a hardcoded cache version is a second number to forget to bump");
  });

  test("test_app_registersTheWorkerWithTheVersion", () => {
    const app = read("../js/app.js");
    assert.match(app, /register\(`\.\/sw\.js\?v=\$\{APP_VERSION\}`\)/,
      "without the version in the URL a release may never reach an existing browser");
  });

  test("test_settings_showsTheVersion", () => {
    // Being able to read the version off the screen is what makes it useful
    // when something looks wrong on a device you aren't holding.
    assert.match(read("../js/views.js"), /v\$\{esc\(APP_VERSION\)\}/);
  });
});

describe("changelog", () => {
  const changelog = read("../CHANGELOG.md");

  test("test_changelog_hasAnEntryForTheCurrentVersion", () => {
    assert.match(changelog, new RegExp(`^## ${APP_VERSION.replace(/\./g, "\\.")}\\b`, "m"),
      `CHANGELOG.md has no "## ${APP_VERSION}" section — a release should not ship undocumented`);
  });

  test("test_changelog_currentEntryCarriesTheReleaseDate", () => {
    const heading = changelog.split("\n").find((l) => l.startsWith(`## ${APP_VERSION}`));
    assert.ok(heading.includes(RELEASED),
      `"${heading}" should carry the release date ${RELEASED} from version.js`);
  });

  test("test_changelog_versionsAreInDescendingOrder", () => {
    // Newest first, so the top of the file is always the version people are on.
    const versions = [...changelog.matchAll(/^## (\d+)\.(\d+)\.(\d+)\b/gm)]
      .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    assert.ok(versions.length > 0, "no version sections found");
    for (let i = 1; i < versions.length; i++) {
      const [a, b] = [versions[i - 1], versions[i]];
      const newer = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
      assert.ok(newer, `${a.join(".")} should come after ${b.join(".")}`);
    }
  });

  test("test_changelog_currentVersionIsTheTopSection", () => {
    const first = changelog.match(/^## (\d+\.\d+\.\d+)\b/m);
    assert.equal(first[1], APP_VERSION,
      "the version in version.js should be the newest one documented");
  });
});

describe("version stamped into synced state", () => {
  test("test_migrateState_recordsWhichReleaseLastWroteTheFile", async () => {
    // Separate from schemaVersion, which describes the data's shape. This says
    // which build produced it, so a synced state that looks wrong can be traced
    // to a release rather than guessed at from commit history.
    const { migrateState } = await import("../js/seed.js");
    const state = migrateState({ patterns: [], problems: [], mocks: [], journal: [],
      systemDesign: { manualUnlock: false, sessions: [] },
      streak: { current: 0, longest: 0, lastActiveDate: null } });
    assert.equal(state.meta.appVersion, APP_VERSION);
  });

  test("test_migrateState_updatesTheStampOnAnOlderFile", async () => {
    const { migrateState } = await import("../js/seed.js");
    const state = migrateState({ meta: { schemaVersion: 4, appVersion: "0.9.0" },
      patterns: [], problems: [], mocks: [], journal: [],
      systemDesign: { manualUnlock: false, sessions: [] },
      streak: { current: 0, longest: 0, lastActiveDate: null } });
    assert.equal(state.meta.appVersion, APP_VERSION, "opening with a newer build should restamp");
  });

  test("test_migrateState_appVersionAndSchemaVersionAreIndependent", async () => {
    // The two answer different questions — which build wrote this, versus what
    // shape the data is in — and stamping one must not move the other, or a
    // release that changes no data shape would look like a migration.
    const { migrateState } = await import("../js/seed.js");
    const base = () => ({ meta: { schemaVersion: 4, createdAt: "2026-01-01T00:00:00.000Z" },
      patterns: [], problems: [], mocks: [], journal: [],
      systemDesign: { manualUnlock: false, sessions: [] },
      streak: { current: 0, longest: 0, lastActiveDate: null } });
    const before = base();
    const after = migrateState(base());
    assert.equal(after.meta.schemaVersion, before.meta.schemaVersion);
    assert.equal(after.meta.createdAt, before.meta.createdAt, "the stamp must not rewrite history");
    assert.equal(after.meta.appVersion, APP_VERSION);
  });
});
