// The live channel (js/live-channel.js).
//
// Stage 2 of docs/realtime-architecture.md: the same events, fast. It sits
// beside the durable channel behind an identical interface, and the emitter
// sends to both without either knowing the other exists. Events carry ids, so
// arriving by both routes is a no-op — which is the whole reason two transports
// can run at once rather than racing.
//
// The division of labour these tests pin: the repo is durable and slow, this is
// fast and forgets. Nothing here may become a place work is kept, because the
// moment it is, losing it costs something.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createLiveChannel, BATCH_MS } from "../js/live-channel.js";

/** An EventSource that a test can push frames into. */
class FakeSource {
  static last = null;
  constructor(url) {
    this.url = url;
    this.closed = false;
    FakeSource.last = this;
  }
  open() { this.onopen?.(); }
  deliver(payload) { this.onmessage?.({ data: JSON.stringify(payload) }); }
  raw(text) { this.onmessage?.({ data: text }); }
  fail() { this.onerror?.(); }
  close() { this.closed = true; }
}

const posted = [];
const fakeFetch = (ok = true) => async (url, init) => {
  posted.push({ url, body: JSON.parse(init.body) });
  if (!ok) throw new Error("offline");
  return { ok: true };
};

const channel = (over = {}) => createLiveChannel({
  relayUrl: "https://relay.example.com", sessionId: "s1", deviceId: "tablet",
  fetchImpl: fakeFetch(), EventSourceImpl: FakeSource, ...over,
});

const event = (id, over = {}) => ({
  id, sessionId: "s1", deviceId: "laptop", seq: 1, at: 1000,
  kind: "element", payload: { id: `el-${id}`, kind: "arrow", points: [] }, ...over,
});

beforeEach(() => { posted.length = 0; FakeSource.last = null; });

describe("receiving", () => {
  test("test_live_anEventArrivesAsItIsDrawn", () => {
    const ch = channel();
    const seen = [];
    ch.subscribe((e) => seen.push(e.id));
    ch.start();
    FakeSource.last.deliver(event("laptop-1"));
    assert.deepEqual(seen, ["laptop-1"]);
  });

  test("test_live_aBatchIsUnpacked", () => {
    // A fast scribble is sent as one request rather than fifty, so what arrives
    // is sometimes an envelope holding several.
    const ch = channel();
    const seen = [];
    ch.subscribe((e) => seen.push(e.id));
    ch.start();
    FakeSource.last.deliver({ batch: [event("a"), event("b")] });
    assert.deepEqual(seen, ["a", "b"]);
  });

  test("test_live_theSameEventTwiceIsAnnouncedOnce", () => {
    // It can arrive here and on the durable channel's next poll. A view that
    // repaints per event would flicker for nothing.
    const ch = channel();
    const seen = [];
    ch.subscribe((e) => seen.push(e.id));
    ch.start();
    FakeSource.last.deliver(event("a"));
    FakeSource.last.deliver(event("a"));
    assert.deepEqual(seen, ["a"]);
  });

  test("test_live_garbageOnTheWireIsIgnoredNotThrownOn", () => {
    // The relay forwards verbatim; anything could be on it.
    const ch = channel();
    ch.start();
    assert.doesNotThrow(() => FakeSource.last.raw("not json"));
    assert.doesNotThrow(() => FakeSource.last.deliver({ no: "id" }));
    assert.equal(ch.state.strokes.length, 0);
  });

  test("test_live_arrivalsBuildTheSameBoardTheReducerWould", () => {
    const ch = channel();
    ch.start();
    FakeSource.last.deliver(event("a"));
    FakeSource.last.deliver(event("b"));
    assert.equal(ch.state.strokes.length, 2);
  });
});

describe("sending", () => {
  test("test_live_publishingIsBatchedNotPerStroke", async () => {
    const ch = channel();
    for (let i = 0; i < 5; i++) ch.publish(event(`x${i}`));
    assert.equal(posted.length, 0, "sent before the batch window closed");
    await ch.flush();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].body.batch.length, 5);
  });

  test("test_live_aSingleEventIsSentPlainNotWrapped", () => {
    // The common case, and an envelope round one event is noise on the wire and
    // a branch in every reader.
    const ch = channel();
    ch.publish(event("only"));
    return ch.flush().then(() => {
      assert.equal(posted[0].body.id, "only");
      assert.equal(posted[0].body.batch, undefined);
    });
  });

  test("test_live_theBatchWindowIsShortEnoughToFeelImmediate", () => {
    assert.ok(BATCH_MS <= 200, `${BATCH_MS}ms of lag before anything is sent`);
  });

  test("test_live_whoSentItIsOnTheRequestSoTheRelayCanSkipTheEcho", async () => {
    const ch = channel();
    ch.publish(event("a"));
    await ch.flush();
    assert.match(posted[0].url, /from=tablet/);
  });

  test("test_live_aFailedSendIsNotRequeued", async () => {
    // Deliberate. The durable channel has the same events and will deliver
    // them; re-queueing here means the same stroke arriving twice by two routes
    // at different times, which is worse than late.
    const ch = channel({ fetchImpl: fakeFetch(false) });
    ch.publish(event("a"));
    await ch.flush();
    assert.equal(ch.status, "offline");
    await ch.flush();
    assert.equal(posted.length, 1, "the failed send was tried again");
  });
});

describe("connection", () => {
  test("test_live_statusFollowsTheStream", () => {
    const ch = channel();
    assert.equal(ch.status, "offline");
    ch.start();
    assert.equal(ch.status, "connecting");
    FakeSource.last.open();
    assert.equal(ch.status, "connected");
  });

  test("test_live_aDroppedStreamIsReportedNotHidden", () => {
    const ch = channel();
    ch.start();
    FakeSource.last.open();
    FakeSource.last.fail();
    assert.equal(ch.status, "offline");
  });

  test("test_live_aDroppedStreamIsClosedBeforeRetrying", () => {
    // EventSource retries on its own and will hammer a dead relay every second
    // forever; closing it is the only way to take over the schedule.
    const ch = channel();
    ch.start();
    const first = FakeSource.last;
    first.fail();
    assert.equal(first.closed, true);
  });

  test("test_live_noRelayConfiguredMeansItQuietlyDoesNothing", async () => {
    // The app is complete without one. This must not throw, and must not make
    // a session that has no relay behave any differently from yesterday's.
    const ch = createLiveChannel({ relayUrl: "", sessionId: "s1", deviceId: "d" });
    assert.doesNotThrow(() => ch.start());
    ch.publish(event("a"));
    await assert.doesNotReject(() => ch.flush());
    assert.equal(ch.status, "offline");
  });

  test("test_live_stopClosesTheStreamAndSendsWhatIsPending", async () => {
    const ch = channel();
    ch.start();
    ch.publish(event("a"));
    const source = FakeSource.last;
    await ch.stop();
    assert.equal(source.closed, true);
    assert.equal(posted.length, 1, "a pending stroke was dropped on the way out");
  });

  test("test_live_afterStopAFailureDoesNotScheduleAReconnect", () => {
    const ch = channel();
    ch.start();
    const source = FakeSource.last;
    ch.stop();
    FakeSource.last = null;
    source.fail();
    assert.equal(FakeSource.last, null, "it reconnected after being stopped");
  });
});

describe("what it never becomes", () => {
  test("test_live_itKeepsNoRecordWorthLosing", () => {
    // The relay stores nothing and this is a cache, not a copy. Everything
    // durable is in the user's own repo, which is also what covers a device
    // that missed an event.
    const ch = channel();
    assert.equal(typeof ch.state, "object");
    assert.equal(ch.stop.length, 0, "stop takes no discard flag — there is nothing to discard");
  });
});
