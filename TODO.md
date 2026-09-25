# Ledger — what to improve next

Ordered by what it costs the user when it's missing, not by how interesting it
is to build. Everything here is an improvement to a feature that already
exists; none of it is a new pillar.

Each item says **what's wrong now** and **what done looks like**, because a
one-line title is not enough to pick the work up again a week later.

---

# Cycle 5

Found by probing the app rather than reading it — the first item is a real
data-loss path that was reproduced in a browser before a line was changed.

## P0 — losing work

- [x] **40. Work done offline was discarded on the next open.** _(1.6.0)_
  The scenario this app is built for: a phone with no signal, a problem
  worked, the save fails, the work goes to localStorage, the tab closes. On
  the next open `init()` fetched the remote, adopted it, and overwrote the
  cache with it — the cached copy was read only when the fetch *failed*.
  `dirty` lived in memory and did not survive the reload, so nothing even knew
  there had been anything to keep. An hour of practice, gone, with the app
  working exactly as written.
  *Done:* a reopen finds that work, keeps it, sends it, and says so — and asks
  only when both sides genuinely have work the other hasn't seen.

- [x] **41. The sync path trusts what it loads; the import path doesn't.** _(1.6.0)_
  `inspectImport` validates a file you pick and refuses one that isn't a
  Ledger log. `migrateState` runs on whatever GitHub returns and only backfills
  missing keys, so a truncated or hand-edited state.json goes straight into the
  renderer. Two paths load the same document and only the rarer one checks it.
  *Done:* one validation on both paths, failing with something you can act on
  rather than a blank page.

## P1 — things you wrote that you can't find

- [x] **42. Journal entries aren't searchable.** _(1.6.0)_
  Cycle 4 made soul statements findable because they are what the app works
  hardest to collect. Weekly retros — which the Journal page itself calls the
  place "where patterns across sessions become visible" — are not in the index,
  and neither are mock notes. Search covers patterns, your problems, your soul
  statements and the catalog, and stops there.
  *Done:* everything you wrote is findable, wherever you wrote it.

- [x] **43. A problem's statement is write-once.** _(1.6.0)_
  Statements arrive from the LeetCode sync or get pasted in, and the workspace
  can edit one. Nothing says where the one you're reading came from, or when,
  and a statement fetched against the wrong problem can only be fixed by
  noticing and retyping it.
  *Done:* a statement says where it came from, and can be replaced from either
  source.

## P2 — the parts that only show up in use

- [x] **44. The day clock can't be corrected.** _(1.6.0)_
  It runs, it pauses, and it is the input to the budget ring and the plant's
  health. Leave it running over lunch and the day is spent, with no way to say
  so. A number you can't correct is a number you stop trusting, and then stop
  looking at.
  *Done:* today's time can be adjusted, with the correction visible as one.

- [x] **45. Nothing carries between a session and the next one on the same
  problem.**
  Reopening a problem you failed last week gives you the statement and an
  empty editor. Your last attempt's code is reachable from the detail page and
  your note from the Journal, but neither is where you are about to need them.
  *Done:* starting a session on a problem you've attempted shows what you did
  last time.

- [x] **46. Your record on a pattern is at the bottom of its topic page.** _(1.6.0)_
  As first written this item claimed the topic page said nothing about how you
  do on the pattern. That was wrong — it ends with attempts, clean rate, recall
  rate, a trend chart and your last six attempts. What is true is where that
  sits: below the hook, the concept, the recognisers, the invariant, the
  pitfalls, two diagrams, the practice ladder and your resource links.
  *Done:* the header answers "how am I doing on this" without a scroll, and the
  full history stays where a chart belongs.

- [ ] **47. Keyboard support stops at the door of every list.**
  `g`-shortcuts reach any page and `?` explains them. Once you are on the
  queue, the bank or the journal, there is no way to move through the list or
  act on a row without a mouse.
  *Done:* the lists you actually work from are navigable from the keyboard.

# Cycle 4

## P0 — the app collects answers it never reads

- [x] **32. The model never finds out whether it was right.** _(1.5.0)_
  Analyze stores its ranked predictions on the problem. The problem then
  records which pattern it actually turned out to be. Nothing has ever
  compared the two. The most elaborate thing in this app has been graded on a
  public benchmark and never once on your problems, which are the only ones
  you care about.
  *Done:* the app reports how often it named your problem's pattern, on your
  own problems, and says plainly when there are too few to tell.

- [x] **33. There is no view of a week.** _(1.5.0)_
  The progress charts show twelve weeks of rates, which answers "am I
  improving" and not "what did I do". Item 31 named this explicitly — "or to
  share what you did this week" — and delivered only the half about one
  problem.
  *Done:* a week in review — what you practised, what moved, what you wrote —
  readable on screen and exportable the way a problem's history is.

## P1 — the same rot, one file along

- [x] **34. views.js is 2,534 lines and sixteen renderers.** _(1.5.0)_
  Setup, conflict, dashboard, queue, log, patterns, journal, system design,
  topics, quiz, warmup, whiteboard, LeetCode, settings, problem detail and day
  detail share a file because that is where they were each born. This is the
  exact state logic.js was in at the start of cycle 3.
  *Done:* split along the same kind of seams, no behaviour change.

- [x] **35. Destructive actions don't behave alike.** _(1.5.0)_
  Removing an attempt offers undo. Removing a problem from the bank offers
  undo. Removing a resource link deletes it silently — no confirmation, no
  undo, no toast. Disconnecting asks with a browser `confirm()`. Three
  different rules for the same kind of act, and the quietest one is on the
  action with no way back.
  *Done:* one rule, applied everywhere something is destroyed.

## P2 — features that stop one step short

- [x] **36. The quiz counts but doesn't teach.** _(1.5.0)_
  It keeps a lifetime score and reveals the right answer. It never says which
  patterns you keep swapping for each other — which is the only part of it
  that would change what you study next.
  *Done:* the drill reports your own confusions, in its own terms.

- [x] **37. Mocks are logged and never reviewed.** _(1.5.0)_
  `state.mocks` accumulates and feeds exactly one thing: the ring that unlocks
  system design. A 45-minute timed run with phases is the closest this app
  gets to the real event, and it leaves no account of itself.
  *Done:* a mock can be looked back at.

- [x] **38. Settings is one long column.** _(1.5.0)_
  Connection, daily budget, box intervals, difficulty estimates, sync
  footprint, import, export, disconnect, the welcome replay and the version,
  in one unbroken scroll. Finding any of it means reading all of it.
  *Done:* structure a person can scan.

- [x] **39. The empty app is the least designed part of it.** _(1.5.0)_
  Every view has an empty state, each written where it sits, some offering the
  action that would end it and some just saying there is nothing here. The
  first hour is the one that decides whether there is a second.
  *Done:* every empty state offers the one action that ends it.

# Cycle 3

## P0 — the app can't answer its own best question

- [x] **24. Your own notes are unsearchable.** _(1.4.0)_
  Soul statements are the thing this app works hardest to collect — "the window
  only shrinks from the left" — and there is no way to find one again. Search
  covers problem titles, patterns and the catalog, and skips every word you
  wrote yourself.
  *Done:* search finds your notes and shows which session each came from.

- [x] **25. Nothing explains itself on first run.** _(1.4.0)_
  A new account lands on a dashboard with a plant, a budget ring, a
  recommendation and a 23-pattern taxonomy, and no indication what any of it
  is for. The reasoning behind every one of those exists — it's in the source
  comments and the changelog, where users don't look.
  *Done:* a first run says what the app is doing and why, once, skippable, and
  never again.

## P1 — the same rot, one file along

- [x] **26. logic.js is 1,254 lines.** _(1.4.0)_
  It now holds scheduling, the plant, planning, stats, progress, the day
  clock, refresher framing, import validation, the size guard, mock phases and
  quiz weighting. It is becoming what views.js was.
  *Done:* split along the same kind of seams, no behaviour change.

- [x] **27. "Offline" doesn't say what it means for you.** _(1.4.0)_
  The status chip reads "Offline — showing cached data". It doesn't say
  whether your last session made it, or what happens if you keep working.
  *Done:* offline states say what is and isn't safe, and what will happen when
  the connection returns.

- [x] **28. The plant's reasoning is buried.** _(1.4.0)_
  It says "stressed" and lists signals, but the mapping from signals to that
  word is only in the source. The plant is the app's headline judgment and the
  least explained thing in it.
  *Done:* the plant can show what specifically moved it, in its own terms.

## P2 — reach and polish

- [x] **29. "Failed" is doing too much work.** _(1.4.0)_
  The outcomes are solved-clean, solved-struggled and failed. Running out of
  time on a hard problem you understood is not the same as not getting it, and
  collapsing them makes the clean-solve rate say less than it could.
  *Done:* an outcome that distinguishes them, with the schedule treating them
  sensibly and old attempts unaffected.

- [x] **30. Charts are readable only if you can see them.** _(1.4.0)_
  The line charts carry a sentence summary; the volume bars and the mastery
  rings carry `title` attributes, which most screen readers ignore.
  *Done:* every chart states its own content the way the line charts do.

- [x] **31. Export is all-or-nothing.** _(1.4.0)_
  You can export the whole log. There is no way to take one problem's history
  somewhere, or to share what you did this week.
  *Done:* a single problem's history can be exported on its own.

# Cycle 2

Drawn from what actually came up while building cycle 1 — the things I noticed
in passing and didn't stop for.

## P0 — heads for a cliff

- [x] **15. Nothing watches the sync payload size.** _(1.3.0)_
  The whole log syncs as one file and GitHub refuses anything over 1 MB. It's
  at 15 KB now, and ~640 bytes per problem projects to ~320 KB at the 500-problem
  cap — but Analyze now writes pasted statements *into* state, at 1–3 KB each,
  and nothing warns before the wall. Hitting it means every save fails at once.
  *Done:* the size is measured, shown in Settings when it matters, and a save
  that would exceed the limit is caught with an explanation and a way to shed
  weight rather than a raw API error.

- [x] **16. A failed sync never retries itself.** _(1.3.0)_
  A save that fails leaves the work in localStorage and the status at "offline"
  until the next mutation happens to trigger a flush. Close the tab in between
  and the only copy is on that device. "Save now" helps, but only if you notice.
  *Done:* failed saves retry on their own with a backoff, and on regaining
  connectivity.

## P1 — the loop leaves value on the table

- [x] **17. Your previous code for a problem isn't there when you return.** _(1.3.0)_
  Every attempt stores the code you wrote, and the workspace opens empty on a
  repeat. Spaced repetition on a problem you solved a month ago is exactly when
  you'd want to see what you did last time — after you've had your attempt.
  *Done:* a previous attempt's code is available in the workspace, deliberately
  behind a reveal so it can't spoil the rep.

- [x] **18. Saved whiteboards aren't attached to anything.** _(1.3.0)_
  A session's drawing is uploaded and indexed by problem id, and the only place
  to see one is the Whiteboard page's flat list.
  *Done:* a problem's page shows the boards drawn while solving it.

- [x] **19. The activity heatmap is a dead end.** _(1.3.0)_
  It shows a year of counts and answers nothing about any of them.
  *Done:* a day can be opened to see what was actually practised.

- [x] **20. The quiz ignores the schedule it sits beside.** _(1.3.0)_
  It cycles through problems while the whole app is built on a spacing
  algorithm. The one page purely about recall is the one not using it.
  *Done:* quiz selection is weighted by what's fading and what you've missed
  before.

## P2 — maintainability and reach

- [x] **21. views.js is 3,095 lines.** _(1.3.0)_
  It holds the dashboard, queue, log, session, reflect, journal, settings,
  topics, problem detail and a dozen shared helpers. Every feature since has
  made it worse, and it's now the file most likely to hide a bug like the
  disabled-button one.
  *Done:* split along seams that already exist, with no behaviour change and
  the test suite green throughout.

- [x] **22. Mock mode is a checklist and nothing else.** _(1.3.0)_
  It flags the attempt and shows five prompts. It doesn't feel different from
  an ordinary session, which is the entire point of practising one.
  *Done:* a mock imposes the structure it's meant to — a clock you can't
  quietly ignore, and prompts that arrive when they'd matter.

- [x] **23. The bank can't be worked from the keyboard.** _(1.3.0)_
  Filters are reachable; the 2,500-row list is mouse-only.
  *Done:* arrow-key movement through results with Enter to start.

## P0 — loses work, or can't be undone

These share a shape with the save bug: the user does real work and the app
quietly fails to keep it.

- [x] **1. A session must survive a page refresh.** _(1.1.0)_
  `session` is module state (`js/views.js`). Reloading mid-problem, following
  a link, or a phone evicting the tab discards the timer, the typed code, the
  whiteboard and the statement. There is no warning and no recovery.
  *Done:* an in-progress session is checkpointed to localStorage and restored
  on load, including elapsed time; leaving the tab and coming back resumes
  exactly where you were.

- [x] **2. Import must validate before it replaces everything.** _(1.1.0)_
  Settings → Import JSON does `Object.assign(s, imported)` on whatever parses.
  A truncated file, an unrelated JSON file, or a hand-edited one with a wrong
  shape silently destroys the entire prep log. CLAUDE.md requires validating at
  boundaries; this is the boundary.
  *Done:* the file is checked for shape before anything is replaced, the user
  is told what it contains ("41 problems, 96 attempts, last written by 1.0.1")
  and confirms against that, and a bad file is refused with a reason.

- [x] **3. An attempt can be corrected or removed.** _(1.1.0)_
  Attempts are write-once. A wrong outcome, a mistyped soul statement, or a
  session logged against the wrong problem is permanent and silently skews
  every statistic downstream.
  *Done:* a problem's history is viewable, and any attempt can be edited or
  deleted, with the box/schedule recomputed from what remains.

- [x] **4. Destructive actions are undoable.** _(1.1.0)_
  Removing from the bank and discarding a session are immediate. Discard is
  behind a `confirm()`, which is a speed bump, not a safety net.
  *Done:* a short-lived Undo on the toast for anything that removes data.

## P1 — the core loop's rough edges

- [x] **5. Sync on demand.** _(1.1.0)_
  The only way to pull changes made on another device is to reload, and there
  is no way to retry a failed push without making another change. "Synced" is
  shown but not when it last happened.
  *Done:* a sync control in Settings showing last-synced time, with refresh
  and retry.

- [x] **6. Save from the keyboard in Reflect.** _(1.1.0)_
  The form is entirely keyboard-reachable but finishing needs a mouse trip to
  the button.
  *Done:* Cmd/Ctrl+Enter saves, and the hint says so.

- [x] **7. A problem's own page.** _(1.1.0)_
  Every attempt is recorded and none of it is readable per problem — you can
  see aggregate stats but not "how have I done on 3Sum over time".
  *Done:* a per-problem view with its attempts, timings, notes and saved code.

## P2 — expanding what's there

- [x] **8. Progress drills down per pattern.** _(1.2.0)_
  The charts are global. "Sliding Window is at 0%" is actionable only if you
  can then see which attempts made it so.
  *Done:* clicking a pattern in Progress or the mastery table shows that
  pattern's own trend and its attempts.

- [x] **9. The bank can be sorted and sampled.** _(1.2.0)_
  ~2,500 rows in catalog order with filters but no ordering, and no way to say
  "give me one".
  *Done:* sort by number/difficulty/confidence, plus a "pick one for me" that
  respects the current filters.

- [x] **10. Analyze can hand off its reasoning.** _(1.2.0)_
  Running an analysis and then starting a problem throws the explanation away.
  *Done:* the analysis attaches to the problem so it's there in the workspace.

- [x] **11. Statements can be fetched on demand.** _(1.2.0)_
  20 per scheduled run means a newly added problem shows a paste box for up to
  a day.
  *Done:* a control that triggers the workflow for the problem in front of you.

- [x] **12. The streak tolerates one missed day.** _(1.2.0)_
  A single missed day resets a long streak to 1, which punishes exactly the
  rest day the rest of the app encourages.
  *Done:* one grace day per week, shown honestly as a grace day rather than
  pretending you practised.

## P3 — model and data quality

- [x] **13. Technique patterns are under-recalled.** _(1.2.0)_
  Binary search sits near 0.9% recall, so sorted-array problems rank
  Arrays & Hashing above Two Pointers. Known and documented, not yet improved.
  *Done:* measured improvement on a held-out set without loosening precision
  below the 0.65 floor.

- [x] **14. Box intervals are editable.** _(1.2.0)_
  `boxIntervalsDays` is in state and honoured everywhere but only changeable
  by hand-editing JSON.
  *Done:* editable in Settings with the effect explained and sane bounds.
