# Live sessions: one event log, two transports

Status: **design, not built.** Nothing in this document is implemented yet.

This exists because of a decision that was nearly made wrongly. The first
proposal was to build cross-device persistence now and choose a realtime
transport later. That is two designs, and they would have produced two code
paths writing the same state — which is the drift this codebase has spent six
cycles removing. Persistence and realtime are the same problem seen at two
latencies, and the architecture has to say so from the start.

---

## 1. The two things that must both work

**Handoff.** Draw on the tablet, close it, open the laptop, the drawing is
there. Draw on the laptop, go back to the tablet, those strokes are there too.
Nothing is live; the devices are never on at the same time. This is a
*durability* problem.

**Liveness.** The tablet is beside the laptop, or an interviewer is watching
from somewhere else. A stroke appears on the other screen in a fraction of a
second. This is a *transport* problem.

A design that solves only the first leaves the mock interview impossible. A
design that solves only the second loses your work the moment a device sleeps.
They are not alternatives.

---

## 2. The model: a session is an append-only log of events

Everything that changes during a session is an event. State is what you get by
replaying them.

```js
{
  id:        "d41f2a-0187",   // `${deviceId}-${seq}`: unique with no coordination
  sessionId: "9c2e…",
  deviceId:  "d41f2a",        // one per browser, stable, not per session
  seq:       187,             // monotonic within this device
  at:        1790271882431,   // epoch ms, for ordering only
  kind:      "stroke",
  payload:   { color: "#111", width: 3, points: [[12,40],[13,41], …] },
}
```

`kind` is one of:

| kind          | written by      | payload                                  |
|---------------|-----------------|------------------------------------------|
| `session`     | the interviewee | problem id, difficulty, the timebox plan |
| `timer`       | the interviewee | `startedAt`, or a pause/resume instant   |
| `stroke`      | either device   | one stroke, exactly as `toJSON()` emits  |
| `stroke-undo` | either device   | the id of the stroke being removed       |
| `board-clear` | either device   | nothing                                  |
| `code`        | the lease holder| a full snapshot of the editor            |
| `rubric`      | the interviewer | which behaviours were observed, a rating |
| `note`        | the interviewer | a line of feedback, timestamped          |

**Why events and not state snapshots.** The two transports have different
latencies, and with snapshots that forces a winner: the slow path arrives
carrying an older whole-world and overwrites the fast path's work. With events
there is nothing to overwrite. A device that missed twenty strokes replays
twenty strokes; a device that is connected receives them one at a time. Same
events, same reducer, both paths.

**Duplicates are free.** Events are identified, so applying one twice is a
no-op. That is what makes it safe to run both transports at once without either
knowing about the other — which is the whole trick.

### Strokes merge without conflict resolution

Drawing is append-only. If both devices drew while apart, the union of their
strokes is simply the right answer, and the order barely matters to what you
see. No CRDT, no last-writer-wins, no choice to get wrong. This is the reason
the whiteboard is the right surface to do first.

`js/whiteboard.js` already serialises to a stroke array and restores from one
(`toJSON` / `restore`). The session checkpoint already captures it. It writes to
`localStorage`, which is per-device — that, and only that, is why handoff does
not work today.

### Code is the one surface that isn't append-only

Text does not merge. Three ways out:

1. Full snapshots, last writer wins — silently loses concurrent edits.
2. A CRDT (Yjs, Automerge) — correct, and a large dependency in a project that
   has none.
3. **A single-writer lease.** Exactly one device may type at a time. The others
   render the code read-only and say where it is being edited, with one click to
   take over.

Three, for reasons that are about this app rather than about distributed
systems. In a mock only the interviewee types — the interviewer is read-only by
role, not by lock. Solo across devices, you are one person at one keyboard.
"Editing on your tablet — take over here" is honest, instant, and something a
person understands, where a merge that silently interleaves two versions of a
function is not.

With one writer guaranteed, `code` events can be plain debounced snapshots.
No diffing, no sequence reconciliation.

### The timer needs no sync at all

Phase state is a pure function of `startedAt` and the plan, both of which are in
the `session` and `timer` events. Every device computes the same phase locally
and cannot drift. One event at the start, nothing after — a free consequence of
the timebox work already shipped.

---

## 3. The transports

One interface. The session does not know which implementations are live.

```js
{
  publish(event),                 // fire and forget
  subscribe(handler),             // returns unsubscribe
  status,                         // "connected" | "connecting" | "offline"
}
```

Two are always in play, doing different jobs.

### The durable channel — your repo

Writes the event log to `prep-data/sessions/<sessionId>.json` in the private
repo, using the sync machinery that already exists.

- **Cadence: coarse.** A ~10s debounce, plus immediately on phase change and on
  submit. Not every stroke — committing to git every two seconds would flood
  the history, burn the rate limit, and still not be fast enough to be worth it.
- **Compaction.** Strokes are the bulk. The file holds the current board plus a
  short tail rather than every event ever, so a long session does not grow
  without bound. It is deleted on submit, once the attempt and the board PNG
  are saved.
- **Not in `state.json`.** That document syncs as one file against a 1 MB
  ceiling, and measurement puts a realistic log at 97% of it around 300
  problems (`npm run measure`). Session scratch has no business in there.
- **On the configured branch, not a separate one.** The design originally said a
  `sessions` branch, to keep `main` a record of releases. That was written
  thinking of the app repo; session logs go to the *data* repo, whose history is
  already a log of practice ("Ledger: session pattern-recall answer"). A branch
  there buys nothing and costs the Git refs API, which the Contents API cannot
  create a branch through.

This alone gives handoff: open any device, replay the log, carry on.

### The fast channel — chosen later, swapped not rewritten

Sub-second. Because the interface above is fixed and duplicate events are free,
which implementation is used changes nothing else in the system.

**Between your own devices, there is an answer with no third party in it.** Both
hold the repo token, so the repo is the signalling channel: one device writes a
WebRTC offer to `prep-data/sessions/<id>/signal/`, the other answers, and once
the peer connection is up, strokes flow directly between the two machines,
encrypted, at full speed. Setup costs a few seconds of polling; the rest of the
session costs nothing. Nobody else is involved at any point.

**For an interviewer, who must not have repo access: a small relay you own,
carrying the handshake, with the strokes still going peer-to-peer.** Decided,
and the reasoning is about interviews rather than about privacy purism.

An interview is forty-five minutes with a stranger who is being generous with
their time. Three things follow, and they outrank elegance:

- **Setup has to be one step.** Not "copy this blob, send it to me, paste what
  it gives you back". Every minute of fiddling is a minute of the interview, and
  the first impression you make is of someone whose tooling does not work.
- **It has to work the first time, on their network.** This is what rules out
  the zero-infrastructure option. WebRTC without a relay fails on restrictive
  NATs, and an interviewer may well be behind a corporate one. A peer-to-peer
  purist design that connects eighty percent of the time is worse in practice
  than a relayed one that connects always — the twenty percent lands in front of
  the person you were trying to impress.
- **They will not debug it.** They click a link, they see the board. Anything
  else and they will ask you to share your screen instead, at which point none
  of this was worth building.

So: a WebSocket relay, on a free tier, under the user's own control. It
forwards and stores nothing. WebRTC is still attempted first, so in the normal
case the strokes travel directly between the two machines and only the
handshake crosses the relay; when the peer connection cannot be established,
the relay carries the events too, and the session works anyway.

What crosses it is worth being precise about, because it is not the thing the
privacy concern was about. It is one session that somebody is already watching:
a public problem statement, the strokes you are drawing for them, the code you
are writing in front of them. Not your practice history, not your notes, not
your log — the interviewer's side never receives the state document at all.

**One mechanism, not two.** The same relay signals the solo tablet-to-laptop
case, rather than that case using the repo and the interview case using the
relay. Two signalling paths for one job is the duplication this codebase has
spent six cycles deleting, and the repo-as-signalling trick — while pleasing —
buys nothing once a relay exists for the case that actually needs one.

### Degradation is the point

If the fast channel never connects, or drops mid-session, the durable channel
keeps working. You lose sub-second updates and keep every stroke. That is the
reason both run rather than one being chosen: there is no failure mode where
work is lost, only one where it is slower.

---

## 4. The session follows the interview, not the editor

Built, ahead of any transport work, because it needed none.

A real interview has an order: you read the problem, you diagram the approach
while the interviewer watches you think, and *then* you write code — with the
diagram still on screen, because the reason you drew it was to code against it.
An editor that dominates the window from the first second teaches the opposite:
start typing, work it out as you go, which is the commonest way a solvable
problem goes wrong.

So the emphasis moves with the timebox phase, which the session already knows:

| phase   | statement | code | board | |
|---------|-----------|------|-------|---|
| Read    | 55% | 30% | 15% | the problem leads |
| Plan    | 25% | 20% | 55% | the board leads, and opens if it was closed |
| Code    | 20% | 52% | 28% | the editor leads, the board stays legible |
| Reflect | 34% | 33% | 33% | all three, to write about |

Two things this deliberately does not do. It never shrinks the board below a
readable share while coding, because referencing the diagram is the stated
reason for having one. And it never closes a panel — opening the board for the
planning phase is supplying the phase's instrument, but shutting one someone is
looking at is help nobody asks for twice.

It defers to you completely: one drag of a splitter and the app stops moving
panes for the rest of the session. A layout that reasserts itself over a
deliberate adjustment is worse than one that never helps, because you cannot
tell whether your drag took effect.

This matters more than it looks for the interviewer view, which will mirror the
same phases: what they see emphasised is what you are supposed to be doing, so
"you spent nineteen minutes in Code with an empty board" is legible to both of
you without anyone saying it.

---

## 5. The interviewer

A separate view, joined by a room code, that has never held the state document.

**Sees:** the problem statement, the whiteboard live, the code live and
read-only, the timer and current phase.

**Does:** ticks the five verbalization behaviours as they happen, rates
communication, leaves timestamped notes.

**Cannot see:** prior attempts, soul statements, code from earlier sessions, the
log. Not as a UI rule that could be got wrong — the interviewer receives events
from one session and nothing else exists on their side to leak.

### This makes the mock data honest

Those five behaviours — clarified constraints, stated the approach aloud,
narrated trade-offs, gave complexity unprompted, tested before declaring done —
are currently ticked by the person being assessed, about themselves, after the
fact. `communicationRating` is a self-score. With an interviewer they become
observations, and the per-behaviour rates the Journal reports start describing
what actually happened. That is a bigger improvement to the mock feature than
the live drawing is.

The interviewer's rubric and notes arrive as events and are folded into the
saved attempt, so a mock you did with someone is the same shape of record as one
you did alone, with better provenance.

---

## 6. Drop, reconnect, and what has to be true

- Every device keeps an outbox of events it has not seen acknowledged, in
  `localStorage`. On reconnect: replay the durable log, merge the outbox, dedupe
  by id.
- This is the shape already proven in `store.js` — `_recoverPendingWork` does
  exactly this for the main log, including the case where both sides changed.
- A device that has been away for an hour is not a special case. It replays.

**Invariants worth testing before any of this is trusted:**

1. Replaying a log twice yields the same state as replaying it once.
2. Two devices' logs merged in either order yield the same board.
3. A stroke that reached the durable channel is never lost, whatever the fast
   channel did.
4. The interviewer's view can be reconstructed from events alone, with no
   access to `state.json`.
5. Exactly one device holds the code lease at any moment.

---

## 7. Staging

The order things get built. Each stage is usable on its own; none of them
require revisiting the ones before.

1. **Event log and reducer**, with the durable channel only. Delivers handoff:
   tablet → laptop → tablet, a few seconds on switch. No new dependency, no
   third party, no server.
2. **The fast channel between your own devices**, WebRTC signalled through your
   repo. Sub-second between tablet and laptop. Still nobody else involved.
3. **The interviewer view and the rubric**, and the relay that introduces them.
   This is the mock interview feature.

Stage 1 is the foundation and not a stopgap: stages 2 and 3 add a transport to
it and change nothing about how state is represented.

---

## 8. Explicitly not in scope

- A CRDT for code. The lease is the answer.
- Audio or video. You are on a call.
- More than one interviewee per session.
- Editing someone else's strokes.
- Presence beyond "connected / not".
