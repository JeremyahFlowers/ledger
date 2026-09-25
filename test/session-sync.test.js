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

import {
  createRepoChannel, createEmitter, sessionPath, PUSH_EVERY_MS,
} from "../js/session-sync.js";
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

describe("the scenario this was built for", () => {
  // Start on the tablet, go to the laptop, draw there, come back to the tablet.
  // Never both awake — which is what makes this a persistence problem and not a
  // realtime one, and why a live peer connection alone would not have solved it.

  const SESSION = "sess-abc";

  /** One device opening the session, doing something, and closing it. */
  const device = async (gh, name, draw) => {
    const ch = createRepoChannel({ gh, sessionId: SESSION });
    const seen = await ch.start();
    const em = createEmitter({ sessionId: SESSION, deviceId: name, channels: [ch] });
    draw(em);
    await ch.stop();
    return seen;
  };

  test("test_sync_tabletToLaptopToTablet", async () => {
    const gh = fakeRepo();

    // Explicit instants. Two devices emitting in the same millisecond are
    // ordered by an id tie-break, which is deterministic but arbitrary — an
    // assertion about order would be testing that alphabet rather than the
    // handoff. Real sessions are minutes apart.
    await device(gh, "tablet", (em) => {
      em.emit("session", { problemId: "3sum", difficulty: "Medium" }, 1000);
      em.emit("stroke", { id: "t1", color: "#000", width: 3, points: [{ x: 1, y: 1 }] }, 2000);
      em.emit("stroke", { id: "t2", color: "#000", width: 3, points: [{ x: 2, y: 2 }] }, 3000);
    });

    const laptopSaw = await device(gh, "laptop", (em) => {
      em.emit("stroke", { id: "l1", color: "#f00", width: 2, points: [{ x: 9, y: 9 }] }, 4000);
    });
    assert.deepEqual(laptopSaw.strokes.map((s) => s.id), ["t1", "t2"],
      "the laptop did not pick up what the tablet drew");

    const tabletSaw = await device(gh, "tablet", () => {});
    assert.deepEqual(tabletSaw.strokes.map((s) => s.id), ["t1", "t2", "l1"],
      "the tablet came back without the laptop's stroke");
  });

  test("test_sync_theProblemAndPlanCarryAcrossDevices", async () => {
    // Not just the drawing: the laptop has to know which problem this is,
    // because the session it is resuming is about something.
    const gh = fakeRepo();
    await device(gh, "tablet", (em) => {
      em.emit("session", { problemId: "3sum", difficulty: "Medium", plan: { totalMin: 45 } });
    });
    const laptopSaw = await device(gh, "laptop", () => {});
    assert.equal(laptopSaw.problemId, "3sum");
    assert.equal(laptopSaw.plan.totalMin, 45);
  });

  test("test_sync_theClockCarriesAcrossDevices", async () => {
    // The timer is instants, not a running total, so the laptop computes the
    // same elapsed time the tablet would have without anything being ticked.
    const gh = fakeRepo();
    await device(gh, "tablet", (em) => em.emit("timer", { action: "start" }, 10_000));
    const laptopSaw = await device(gh, "laptop", () => {});
    assert.equal(laptopSaw.startedAt, 10_000);
  });

  test("test_sync_anUndoOnOneDeviceIsSeenOnTheOther", async () => {
    const gh = fakeRepo();
    await device(gh, "tablet", (em) => {
      em.emit("stroke", { id: "t1", color: "#000", width: 3, points: [{ x: 1, y: 1 }] }, 1000);
      em.emit("stroke", { id: "t2", color: "#000", width: 3, points: [{ x: 2, y: 2 }] }, 2000);
    });
    await device(gh, "laptop", (em) => em.emit("stroke-undo", { strokeId: "t2" }, 3000));
    const tabletSaw = await device(gh, "tablet", () => {});
    assert.deepEqual(tabletSaw.strokes.map((s) => s.id), ["t1"]);
  });
});

describe("the emitter", () => {
  test("test_emitter_sequenceNumbersAreNeverReused", () => {
    // Two events sharing a sequence share an id, and then one of them silently
    // disappears into the deduplication. This is the single piece of state that
    // must not be duplicated.
    const sent = [];
    const em = createEmitter({
      sessionId: "s1", deviceId: "d1",
      channels: [{ publish: (e) => sent.push(e), subscribe: () => () => {} }],
    });
    for (let i = 0; i < 5; i++) em.emit("stroke", { id: `x${i}` });
    assert.equal(new Set(sent.map((e) => e.id)).size, 5);
  });

  test("test_emitter_returnsTheEventSoItCanBeAppliedLocally", () => {
    // Without waiting for a channel to echo it back — which, for the durable
    // channel, would be ten seconds.
    const em = createEmitter({ sessionId: "s1", deviceId: "d1", channels: [] });
    const e = em.emit("note", { text: "hello" });
    assert.equal(e.kind, "note");
    assert.equal(e.payload.text, "hello");
  });

  test("test_emitter_worksWithNoChannelsAtAll", () => {
    // No repo configured, or offline from the first second. The session still
    // runs; the events just have nowhere to go yet.
    const em = createEmitter({ sessionId: "s1", deviceId: "d1", channels: null });
    assert.doesNotThrow(() => em.emit("stroke", { id: "a" }));
  });

  test("test_emitter_sendsToEveryChannel", () => {
    // The reason channels is a list: the durable one and a live one will both
    // be attached, and neither needs to know about the other.
    const a = []; const b = [];
    const em = createEmitter({
      sessionId: "s1", deviceId: "d1",
      channels: [
        { publish: (e) => a.push(e), subscribe: () => () => {} },
        { publish: (e) => b.push(e), subscribe: () => () => {} },
      ],
    });
    em.emit("stroke", { id: "x" });
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.equal(a[0].id, b[0].id, "the same event must carry the same id down both");
  });
});
