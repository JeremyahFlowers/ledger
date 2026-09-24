# Ledger — what to improve next

Ordered by what it costs the user when it's missing, not by how interesting it
is to build. Everything here is an improvement to a feature that already
exists; none of it is a new pillar.

Each item says **what's wrong now** and **what done looks like**, because a
one-line title is not enough to pick the work up again a week later.

---

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

- [ ] **3. An attempt can be corrected or removed.**
  Attempts are write-once. A wrong outcome, a mistyped soul statement, or a
  session logged against the wrong problem is permanent and silently skews
  every statistic downstream.
  *Done:* a problem's history is viewable, and any attempt can be edited or
  deleted, with the box/schedule recomputed from what remains.

- [ ] **4. Destructive actions are undoable.**
  Removing from the bank and discarding a session are immediate. Discard is
  behind a `confirm()`, which is a speed bump, not a safety net.
  *Done:* a short-lived Undo on the toast for anything that removes data.

## P1 — the core loop's rough edges

- [ ] **5. Sync on demand.**
  The only way to pull changes made on another device is to reload, and there
  is no way to retry a failed push without making another change. "Synced" is
  shown but not when it last happened.
  *Done:* a sync control in Settings showing last-synced time, with refresh
  and retry.

- [ ] **6. Save from the keyboard in Reflect.**
  The form is entirely keyboard-reachable but finishing needs a mouse trip to
  the button.
  *Done:* Cmd/Ctrl+Enter saves, and the hint says so.

- [ ] **7. A problem's own page.**
  Every attempt is recorded and none of it is readable per problem — you can
  see aggregate stats but not "how have I done on 3Sum over time".
  *Done:* a per-problem view with its attempts, timings, notes and saved code.

## P2 — expanding what's there

- [ ] **8. Progress drills down per pattern.**
  The charts are global. "Sliding Window is at 0%" is actionable only if you
  can then see which attempts made it so.
  *Done:* clicking a pattern in Progress or the mastery table shows that
  pattern's own trend and its attempts.

- [ ] **9. The bank can be sorted and sampled.**
  ~2,500 rows in catalog order with filters but no ordering, and no way to say
  "give me one".
  *Done:* sort by number/difficulty/confidence, plus a "pick one for me" that
  respects the current filters.

- [ ] **10. Analyze can hand off its reasoning.**
  Running an analysis and then starting a problem throws the explanation away.
  *Done:* the analysis attaches to the problem so it's there in the workspace.

- [ ] **11. Statements can be fetched on demand.**
  20 per scheduled run means a newly added problem shows a paste box for up to
  a day.
  *Done:* a control that triggers the workflow for the problem in front of you.

- [ ] **12. The streak tolerates one missed day.**
  A single missed day resets a long streak to 1, which punishes exactly the
  rest day the rest of the app encourages.
  *Done:* one grace day per week, shown honestly as a grace day rather than
  pretending you practised.

## P3 — model and data quality

- [ ] **13. Technique patterns are under-recalled.**
  Binary search sits near 0.9% recall, so sorted-array problems rank
  Arrays & Hashing above Two Pointers. Known and documented, not yet improved.
  *Done:* measured improvement on a held-out set without loosening precision
  below the 0.65 floor.

- [ ] **14. Box intervals are editable.**
  `boxIntervalsDays` is in state and honoured everywhere but only changeable
  by hand-editing JSON.
  *Done:* editable in Settings with the effect explained and sane bounds.
