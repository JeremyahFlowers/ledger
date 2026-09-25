// The durable channel (js/session-sync.js).
//
// Stage 1b of docs/realtime-architecture.md. This is what makes handoff work:
// draw on the tablet, close it, open the laptop, the drawing is there. It is
// deliberately not the live channel — a git commit takes a second or two and the
// rate limit is real, so a stroke-by-stroke cadence would flood the history and
// still not feel live.
//
// The property that matters most is that two devices which both wrote cannot
// clobber each other. It holds because the channel reads and merges before it
// writes, and the merge is commutative — so which device pushed last does not
// decide whose strokes survive.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createRepoChannel, sessionPath, PUSH_EVERY_MS } from "../js/session-sync.js";
import { makeEvent, reduce } from "../js/session-log.js";

const ev = (seq, kind, payload = {}, at = 1000 + seq, device = "d1") =>
  makeEvent({ sessionId: "s1", deviceId: device, seq, kind, payload, at });
const stroke = (seq, at, device = "d1") =>
  ev(seq, "stroke", { color: "#000", width: 3, points: [[seq, seq]] }, at, device);

/** A repo that behaves like the Contents API: shas, 409 on a stale write. */
function fakeRepo({ failWrites = false } = {}) {
  const files = new Map();
  let shaSeq = 0;
  return {
    files,
    // A property, not a closure variable, so a test can turn failing off
    // half-way and watch the retry succeed.
    failWrites,
    writes: 0,
    reads: 0,
    deletes: [],
    async readJsonFile(path) {
      this.reads += 1;
      const f = files.get(path);
      return f ? { data: JSON.parse(JSON.stringify(f.data)), sha: f.sha } : null;
    },
    async writeJsonFile(path, data, { sha = null } = {}) {
      this.writes += 1;
      if (this.failWrites) { const e = new Error("offline"); e.code = "network"; throw e; }
      const existing = files.get(path);
      if (existing && existing.sha !== sha) { const e = new Error("stale"); e.code = "conflict"; throw e; }
      const next = `sha${++shaSeq}`;
      files.set(path, { data: JSON.parse(JSON.stringify(data)), sha: next });
      return next;
    },
    async deleteFile(path, sha) { this.deletes.push([path, sha]); files.delete(path); },
  };
}

const channelOn = (gh, id = "s1") => createRepoChannel({ gh, sessionId: id, now: () => 5000 });

describe("where the log lives", () => {
  test("test_sync_oneFilePerSession", () => {
    assert.equal(sessionPath("abc-123"), "prep-data/sessions/abc-123.json");
  });

  test("test_sync_notInTheStateDocument", () => {
    // state.json syncs as one file against a 1 MB ceiling that a realistic log
    // already reaches 97% of. Session scratch has no business in it.
    assert.doesNotMatch(sessionPath("x"), /state\.json/);
  });
});

describe("handoff: a device that was away catches up", () => {
  let gh;
  beforeEach(() => { gh = fakeRepo(); });

  test("test_sync_startLoadsWhatTheRepoHas", async () => {
    gh.files.set(sessionPath("s1"), { sha: "sha0", data: { sessionId: "s1", events: [stroke(0, 100), stroke(1, 200)] } });
    const state = await channelOn(gh).start();
    assert.equal(state.strokes.length, 2);
  });

  test("test_sync_startOnAnEmptySessionIsNotAnError", async () => {
    const state = await channelOn(gh).start();
    assert.deepEqual(state.strokes, []);
  });

  test("test_sync_subscribersHearAboutEventsThatArriveFromElsewhere", async () => {
    gh.files.set(sessionPath("s1"), { sha: "sha0", data: { events: [stroke(0, 100)] } });
    const ch = channelOn(gh);
    const heard = [];
    ch.subscribe((e) => heard.push(e.id));
    await ch.start();
    assert.deepEqual(heard, ["d1-0"]);
  });

  test("test_sync_subscribersAreNotToldAboutTheirOwnEventsTwice", async () => {
    const ch = channelOn(gh);
    const heard = [];
    ch.subscribe((e) => heard.push(e.id));
    ch.publish(stroke(0, 100));
    await ch.flush();
    assert.deepEqual(heard, [], "an event this device published came back as news");
  });
});

describe("two devices that both wrote", () => {
  test("test_sync_neitherClobbersTheOther", async () => {
    // The property the whole design rests on. Both push; both boards end up
    // with both strokes.
    const gh = fakeRepo();
    const tablet = channelOn(gh);
    const laptop = channelOn(gh);
    await tablet.start();
    await laptop.start();

    tablet.publish(stroke(0, 100, "tablet"));
    laptop.publish(stroke(0, 200, "laptop"));
    await tablet.flush();
    await laptop.flush();

    const stored = gh.files.get(sessionPath("s1")).data.events;
    assert.equal(reduce(stored).strokes.length, 2);
  });

  test("test_sync_whichPushedLastDoesNotDecideWhoSurvives", async () => {
    const forward = fakeRepo();
    const reverse = fakeRepo();
    for (const [gh, order] of [[forward, "ab"], [reverse, "ba"]]) {
      const a = channelOn(gh);
      const b = channelOn(gh);
      await a.start(); await b.start();
      a.publish(stroke(0, 100, "a"));
      b.publish(stroke(0, 200, "b"));
      if (order === "ab") { await a.flush(); await b.flush(); }
      else { await b.flush(); await a.flush(); }
    }
    const boardOf = (gh) => reduce(gh.files.get(sessionPath("s1")).data.events).strokes.map((s) => s.id);
    assert.deepEqual(boardOf(forward), boardOf(reverse));
  });

  test("test_sync_aStaleShaIsRecoveredFromRatherThanLosingTheWrite", async () => {
    // A 409 means somebody else wrote first. The strokes are still in memory, so
    // the answer is to re-read, merge and try again — never to drop them.
    const gh = fakeRepo();
    const ch = channelOn(gh);
    await ch.start();
    gh.files.set(sessionPath("s1"), { sha: "somebody-else", data: { events: [stroke(9, 50, "other")] } });
    ch.publish(stroke(0, 100));
    await ch.flush();   // first attempt hits the stale sha
    await ch.flush();   // retry after re-reading
    const stored = reduce(gh.files.get(sessionPath("s1")).data.events);
    assert.equal(stored.strokes.length, 2, "a stroke was lost resolving a conflict");
  });
});

describe("what happens when the repo can't be reached", () => {
  test("test_sync_aFailedPushKeepsTheWorkAndReportsOffline", async () => {
    const gh = fakeRepo({ failWrites: true });
    const ch = channelOn(gh);
    ch.publish(stroke(0, 100));
    await ch.flush();
    assert.equal(ch.status, "offline");
    assert.equal(ch.state.strokes.length, 1, "the stroke was dropped when the push failed");
  });

  test("test_sync_aFailedPushIsRetriedOnTheNextFlush", async () => {
    const gh = fakeRepo({ failWrites: true });
    const ch = channelOn(gh);
    ch.publish(stroke(0, 100));
    await ch.flush();
    gh.failWrites = false;
    await ch.flush();
    assert.ok(gh.files.has(sessionPath("s1")), "the retry never happened");
  });

  test("test_sync_nothingToSend_doesNotWrite", async () => {
    // A session where nobody drew should not produce a commit.
    const gh = fakeRepo();
    const ch = channelOn(gh);
    await ch.start();
    await ch.flush();
    assert.equal(gh.writes, 0);
  });
});

describe("cadence", () => {
  test("test_sync_publishingIsDebouncedNotPerEvent", () => {
    // A stroke every 40ms would otherwise be a commit every 40ms.
    assert.ok(PUSH_EVERY_MS >= 5000, `pushing every ${PUSH_EVERY_MS}ms is a commit storm`);
  });

  test("test_sync_manyStrokesBeforeAFlushAreOneWrite", async () => {
    const gh = fakeRepo();
    const ch = channelOn(gh);
    await ch.start();
    for (let i = 0; i < 50; i++) ch.publish(stroke(i, 1000 + i));
    await ch.flush();
    assert.equal(gh.writes, 1);
  });
});

describe("ending a session", () => {
  test("test_sync_stopSendsAnythingUnsent", async () => {
    const gh = fakeRepo();
    const ch = channelOn(gh);
    await ch.start();
    ch.publish(stroke(0, 100));
    await ch.stop();
    assert.equal(reduce(gh.files.get(sessionPath("s1")).data.events).strokes.length, 1);
  });

  test("test_sync_discardRemovesTheScratchFile", async () => {
    // Once the attempt and the board PNG are saved, the event log is not the
    // durable record and should not accumulate one file per session forever.
    const gh = fakeRepo();
    gh.files.set(sessionPath("s1"), { sha: "sha0", data: { events: [stroke(0, 100)] } });
    const ch = channelOn(gh);
    await ch.start();
    await ch.stop({ discard: true });
    assert.equal(gh.files.has(sessionPath("s1")), false);
  });

  test("test_sync_discardingAFileThatIsAlreadyGoneIsFine", async () => {
    const gh = fakeRepo();
    const ch = channelOn(gh);
    await ch.start();
    await assert.doesNotReject(() => ch.stop({ discard: true }));
  });

  test("test_sync_afterStopNothingElseIsWritten", async () => {
    const gh = fakeRepo();
    const ch = channelOn(gh);
    await ch.start();
    await ch.stop();
    const writes = gh.writes;
    ch.publish(stroke(0, 100));
    await ch.flush();
    assert.equal(gh.writes, writes, "the channel wrote after it was stopped");
  });
});
