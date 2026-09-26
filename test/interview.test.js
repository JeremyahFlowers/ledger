// The interviewer's side (js/interview.js, js/rubric.js, and the protocol).
//
// Stage 3 of docs/realtime-architecture.md. The most valuable thing here is not
// the live drawing: it is that the five verbalization behaviours stop being
// ticked by the person being assessed, about themselves, after the fact, and
// become something an observer recorded while it was happening.
//
// The guarantee that matters is structural rather than a rule a view has to
// remember: the interviewer's page never imports the store, so it has no
// config, no token, and no practice log to leak from.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { reduce, makeEvent } from "../js/session-log.js";
import { MOCK_CHECKLIST } from "../js/rubric.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const interview = read("../js/interview.js");
const page = read("../interview.html");
const sessionView = read("../js/session-view.js");

const ev = (seq, kind, payload = {}, at = 1000 + seq, device = "them") =>
  makeEvent({ sessionId: "s1", deviceId: device, seq, kind, payload, at });

describe("what the watcher can reach", () => {
  test("test_interview_thePageNeverImportsTheStore", () => {
    // The whole guarantee. With no store there is no GitHub config, no token,
    // and no practice log — prior attempts and soul statements have nowhere to
    // leak from because on that side they do not exist.
    assert.doesNotMatch(interview, /from ["']\.\/store\.js["']/);
    assert.doesNotMatch(interview, /from ["']\.\/views\.js["']/);
    assert.doesNotMatch(page, /js\/app\.js/);
  });

  test("test_interview_itImportsOnlyWhatItDraws", () => {
    const imports = [...interview.matchAll(/from ["']\.\/([\w-]+)\.js["']/g)].map((m) => m[1]);
    assert.deepEqual(imports.sort(), ["live-channel", "rubric", "session-log", "whiteboard"]);
  });

  test("test_interview_theRubricIsItsOwnModuleForThatReason", () => {
    // Importing it from logic.js would drag the whole domain layer onto a page
    // whose safety comes from importing almost nothing.
    const rubric = read("../js/rubric.js");
    assert.doesNotMatch(rubric, /^import /m);
    assert.equal(MOCK_CHECKLIST.length, 5);
  });

  test("test_interview_theSessionEventCarriesTheProblemAndNothingElse", () => {
    const emitted = sessionView.slice(sessionView.indexOf('emit("session"'));
    const block = emitted.slice(0, emitted.indexOf("});"));
    for (const leak of ["attempts", "soulStatement", "analysis", "box", "nextReviewDate"]) {
      assert.doesNotMatch(block, new RegExp(leak), `the session event carries ${leak}`);
    }
    for (const needed of ["problemName", "statement", "difficulty", "plan"]) {
      assert.match(block, new RegExp(needed), `the watcher cannot see ${needed}`);
    }
  });
});

describe("joining late", () => {
  // The relay stores nothing, so somebody arriving ten minutes in sees an empty
  // board and has no way to know it is wrong. `hello` is the only moment anyone
  // can tell them.

  test("test_interview_helloIsAnEventKindTheReducerKnows", () => {
    const state = reduce([ev(0, "hello", { role: "interviewer" })]);
    assert.equal(state.joined.length, 1);
    assert.equal(state.joined[0].role, "interviewer");
  });

  test("test_interview_theAnswerRebuildsEverythingTheyMissed", () => {
    // A board snapshot, the problem, the clock and the code — which is exactly
    // what a watcher's screen is made of.
    const answer = sessionView.slice(sessionView.indexOf("function answerHello()"));
    const body = answer.slice(0, answer.indexOf("\n  }\n"));
    for (const kind of ['"session"', '"timer"', '"board"', '"code"']) {
      assert.match(body, new RegExp(kind), `a newcomer is never sent ${kind}`);
    }
  });

  test("test_interview_theSnapshotReplacesTheBoardRatherThanAppending", () => {
    // `board` is the kind that already means "this is everything". One event
    // per element would be correct and would also be a hundred requests.
    const state = reduce([
      ev(0, "element", { id: "a", kind: "rect", points: [{ x: 0, y: 0 }] }),
      ev(1, "board", { strokes: [{ id: "b", kind: "cells", points: [{ x: 1, y: 1 }] }], absorbed: {} }, 2000),
    ]);
    assert.deepEqual(state.strokes.map((s) => s.id), ["b"]);
  });

  test("test_interview_theClockIsRebuiltFromTheOriginalInstant", () => {
    // Re-sent with the original `at`, not the moment of re-sending, or a
    // watcher who joins at minute ten sees a timer starting from zero.
    const answer = sessionView.slice(sessionView.indexOf("function answerHello()"));
    assert.match(answer.slice(0, 900), /emit\("timer", \{ action: "start" \}, session\.startedAt\)/);
  });
});

describe("what comes back", () => {
  test("test_interview_observationsMerge", () => {
    // Ticking a fifth box must not clear the four already ticked when the
    // events arrive separately.
    const state = reduce([
      ev(0, "rubric", { observed: { 0: true } }),
      ev(1, "rubric", { observed: { 3: true } }, 2000),
      ev(2, "rubric", { rating: 4 }, 3000),
    ]);
    assert.deepEqual(state.rubric, { 0: true, 3: true });
    assert.equal(state.rating, 4);
  });

  test("test_interview_anObservationBeatsASelfReport", () => {
    // The entire reason this view exists. These five were self-reported, after
    // the fact, by the person being assessed.
    assert.match(sessionView, /const checklist = observed \? \{ \.\.\.session\.checklist, \.\.\.observed \} : \{ \.\.\.session\.checklist \}/);
  });

  test("test_interview_theAttemptRecordsWhichKindOfEvidenceItIs", () => {
    // A rate computed over a mix of self-reports and observations, with no way
    // to tell them apart, is a number that quietly means two things.
    assert.match(sessionView, /observedBy = observed \? "interviewer" : "self"/);
    assert.match(sessionView, /observedBy,/);
  });

  test("test_interview_aWatchersRatingBeatsTheSelfRating", () => {
    assert.match(sessionView, /communicationRating: session\.observedRating/);
  });

  test("test_interview_notesReachTheAttempt", () => {
    assert.match(sessionView, /notes: \(session\.interviewerNotes \|\| \[\]\)/);
  });
});

describe("the link", () => {
  test("test_interview_bothHalvesAreInTheFragment", () => {
    // A fragment is never sent to a server, so the room id stays out of access
    // logs and out of whatever scans a link pasted into a chat.
    assert.match(sessionView, /interview\.html`\s*\+\s*`#\$\{encodeURIComponent/);
  });

  test("test_interview_sharingWithoutARelaySaysSoRatherThanCopyingADeadLink", () => {
    assert.match(sessionView, /Set a live sync relay in Settings first/);
  });

  test("test_interview_aRefusedClipboardFallsBackRatherThanFailingSilently", () => {
    const share = sessionView.slice(sessionView.indexOf('#ws-share'));
    assert.match(share.slice(0, 1400), /prompt\(/);
  });

  test("test_interview_openingThePageWithNoLinkExplainsItself", () => {
    assert.match(interview, /Nothing to watch/);
    assert.match(interview, /Share/);
  });
});

describe("the board on the watcher's side", () => {
  test("test_interview_itIsTheSameRendererNotASecondCopy", () => {
    // Two renderers for one drawing would drift, and the first time anyone
    // noticed would be an interview where the two screens disagreed.
    assert.match(interview, /createWhiteboard\(.*\{ readOnly: true \}\)/s);
  });

  test("test_interview_theWatcherGetsTheReadOnlyBoard", () => {
    // That a read-only board wires no input at all is pinned where it can be
    // checked by running it rather than by reading it — see
    // test/whiteboard.test.js. A source match here pinned the spelling of one
    // `if`, and broke the first time the guards became a single block.
    const wb = read("../js/whiteboard.js");
    assert.match(wb, /const readOnly = !!hooks\.readOnly/);
  });
});
