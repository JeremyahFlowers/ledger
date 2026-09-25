// Which copy of the app this is, and what it may touch (js/channel.js).
//
// There was one copy of Ledger, deployed straight to the URL its owner
// practises on, sharing one data file and one set of browser keys. Testing a
// change meant testing against real practice history, and a development build
// opened on the same machine read the same cached state — which is how test
// data ends up in front of someone trying to use the thing.
//
// The channel is derived from the URL and nothing else. Not a build step, of
// which this project has none, and not a flag, which is something you forget to
// set — and the one time it mattered, it was forgotten.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { channelOf, storageKey, defaultDataPath, STABLE, DEV } from "../js/channel.js";

const at = (hostname, pathname) => ({ hostname, pathname });

describe("deciding the channel", () => {
  test("test_channel_thePublishedSite_isStable", () => {
    assert.equal(channelOf(at("jeremyahflowers.github.io", "/ledger/")), STABLE);
    assert.equal(channelOf(at("jeremyahflowers.github.io", "/ledger/index.html")), STABLE);
  });

  test("test_channel_theDevPath_isDev", () => {
    assert.equal(channelOf(at("jeremyahflowers.github.io", "/ledger/dev/")), DEV);
    assert.equal(channelOf(at("jeremyahflowers.github.io", "/ledger/dev/index.html")), DEV);
  });

  test("test_channel_localhostIsAlwaysDev", () => {
    // The case that went wrong before this existed. A local server is by
    // definition somewhere changes are being tried.
    for (const host of ["localhost", "127.0.0.1", "[::1]", "mac.local"]) {
      assert.equal(channelOf(at(host, "/index.html")), DEV, host);
    }
  });

  test("test_channel_devMustBeAWholePathSegment", () => {
    // A substring test would call a stable deployment at /ledger-dev-notes/ a
    // development build, and quietly point it at the wrong data file.
    assert.equal(channelOf(at("example.com", "/ledger-dev-notes/")), STABLE);
    assert.equal(channelOf(at("example.com", "/development/")), STABLE);
  });

  test("test_channel_missingLocation_doesNotThrow", () => {
    assert.doesNotThrow(() => channelOf(undefined));
    assert.doesNotThrow(() => channelOf({}));
  });

  test("test_channel_unknownHost_defaultsToStable", () => {
    // Guessing dev would hide a real deployment's data from it. Stable is the
    // safe default because it is the one that already has the keys it needs.
    assert.equal(channelOf(at("example.com", "/")), STABLE);
  });
});

describe("keeping the two apart", () => {
  test("test_channel_stableKeepsItsExistingKeys", () => {
    // Renaming these would orphan every setting, cached log and open session
    // that already exists in somebody's browser.
    assert.equal(storageKey("ledger.config", STABLE), "ledger.config");
    assert.equal(storageKey("ledger.cache.state", STABLE), "ledger.cache.state");
  });

  test("test_channel_devGetsItsOwnKeys", () => {
    assert.equal(storageKey("ledger.config", DEV), "ledger.config.dev");
    assert.notEqual(storageKey("ledger.cache.state", DEV), storageKey("ledger.cache.state", STABLE));
  });

  test("test_channel_theTokenIsNamespacedToo", () => {
    // The most important one. A dev build inheriting the stable config would
    // inherit write access to a real practice log.
    assert.notEqual(storageKey("ledger.config", DEV), "ledger.config");
  });

  test("test_channel_devDefaultsToADifferentDataFile", () => {
    assert.equal(defaultDataPath(STABLE), "prep-data/state.json");
    assert.notEqual(defaultDataPath(DEV), defaultDataPath(STABLE));
  });
});

describe("every stored key goes through it", () => {
  const JS = fileURLToPath(new URL("../js", import.meta.url));
  const files = ["app.js", "store.js", "session-store.js", "split-pane.js", "welcome.js", "settings-view.js"];

  test("test_channel_noModuleUsesARawLedgerKey", () => {
    // One raw key is one piece of state the two channels share, and it only
    // takes one to put a dev session's data in front of a real user.
    for (const file of files) {
      const src = readFileSync(`${JS}/${file}`, "utf8");
      const raw = (src.match(/["'`]ledger\.[\w.]+["'`]/g) || [])
        .filter((m) => !new RegExp(`storageKey\\(\\s*${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(src));
      assert.deepEqual(raw, [], `${file} stores ${raw.join(", ")} without namespacing it`);
    }
  });
});

describe("what dev does not do", () => {
  test("test_channel_devDoesNotRegisterAServiceWorker", () => {
    // A development copy that caches is one that serves you yesterday's code
    // while you are trying to find out whether today's works.
    const app = readFileSync(fileURLToPath(new URL("../js/app.js", import.meta.url)), "utf8");
    assert.match(app, /if \(!IS_DEV && "serviceWorker" in navigator\)/);
  });

  test("test_channel_devSaysSoOnScreen", () => {
    const app = readFileSync(fileURLToPath(new URL("../js/app.js", import.meta.url)), "utf8");
    const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
    assert.match(html, /id="channel-badge"/);
    assert.match(app, /channelBadge.*IS_DEV|IS_DEV.*channelBadge/s);
    assert.match(app, /channelBadge\.hidden = false/);
  });
});
