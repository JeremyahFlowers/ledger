# Depth pass

Started 2026-09-29, after the feedback that the app feels like a proof of
concept: a breadth of features, none thoroughly vetted, not connected to each
other. The rule for this pass is **no new features** until what exists works
as one thing. Each phase is verified by using it the way the owner does — open
the app, pick a problem, work it, move on — not by checking pieces in isolation.

Ordered by how directly each touches the daily loop.

## Phase 1 — The coding session

- [ ] **One screen from Start.** The separate "start the timer" page goes; the
      problem, the editor and the board are all there from the first second.
      Today the board is hidden until the Plan phase, five minutes in, after
      you have already started thinking.
- [ ] **Tools stay selected.** Drawing a shape no longer hands you back Select.
      That was a deliberate choice, and the wrong one.
- [ ] **The shortcuts a drawing tool is expected to have**, with a cheat sheet
      on `?`: multi-select (drag a marquee, shift-click), select all, move a
      group, copy / cut / paste / duplicate, number keys for tools.
- [ ] **The day's time counts live.** Time spent in a session counts against
      the day as it passes, instead of dropping all at once when the problem is
      saved. "Work lined up" (an estimate of the plan) is kept visibly separate
      from time actually used.

## Phase 2 — Recommendations

- [ ] **A current focus.** What you are working on — set by you, or read from
      what you have been doing — shapes what comes next. A pattern you already
      have down is not the one suggested.
- [ ] **Variety.** A weighted pick among good candidates, stable through the
      day, with "suggest something else". Not the same first problem every time.
- [ ] **The whole catalog.** Suggestions draw on the ~2,500 labelled problems,
      not only the problems already in your list.

## Phase 3 — Everything you can learn, you can practise

- [ ] **Every topic page starts a real problem** for that pattern, at the
      right difficulty, from the catalog. 9 of 23 patterns currently have no
      problems at all, so their practice section is a dead end.
- [ ] **Every component is used somewhere.** 12 of 34 appear in no design
      problem. Each gets a problem or a deep dive that needs it.

## Phase 4 — A whiteboard you can think on

- [ ] **Connectors** that attach to shapes and follow them when moved, with
      labels on the line. Without these an architecture diagram falls apart the
      first time you rearrange it.
- [ ] **A component stencil**: place "Load balancer", "Cache", "Queue",
      "Database" on the board as labelled shapes, so the component library is
      something you draw with rather than something you read.
- [ ] **Deeper component pages**: worked numbers, and where the component
      appears in the reference answers.

## Phase 5 — One app

- [ ] Walk a full configured week, day by day, as the owner. Fix every place
      where one feature does not lead to the next.
