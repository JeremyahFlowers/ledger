# Changelog

The version shown in Settings, and the record of what changed between releases.

Versioning is [semver](https://semver.org/) read for an app rather than a
library: **major** when the shape of the thing changes — a workflow works
differently than it did, or stored data needs migrating; **minor** for new
capability that leaves everything existing working as before; **patch** for
fixes and polish.

The version lives in `js/version.js` and nowhere else. The service worker is
registered as `./sw.js?v=<version>` and names its cache after it, so bumping
the version is what invalidates the old cache *and* what makes the browser
treat the worker as new and install it. That is the whole reason it is not
just a label: a release that forgets to bump it reaches nobody, and looks
completely fine locally while doing so.

### Cutting a release

1. Bump `APP_VERSION` and `RELEASED` in `js/version.js`.
2. Add a section here, newest at the top, headed `## <version> — <date>`.
3. `npm run verify` — this fails if the changelog has no entry for the current
   version, if the versions here are out of order, or if a new module is
   missing from the service worker's precache list.
4. Commit, `git tag v<version>`, push both.

Steps 1–2 are the only manual ones; everything downstream derives.

---

## 1.2.0 — 2026-09-24

The rest of TODO.md: expanding what was already there.

### The model says more, without saying it louder

The weak technique patterns turned out not to be a capacity problem.
Backtracking had an AUC of 0.930 and fired on 11.7% of true cases; binary
search 0.746 and 0.6%. One operating point was doing two jobs — the ranked
list only needs good ordering, the confident badge needs to be right — and at
a ~2% base rate a 65% precision floor is demanding enough that recall was the
price.

- **A second "likely" tier**, measured at a 55% precision floor. Greedy goes
  from 6.7% to 34.9% recall, binary search 0.6% to 11.2%, sliding window 9.7%
  to 25.0%. The confident badge and its guarantee are unchanged; both tiers
  show their measured precision, so neither is taken on trust. A sorted-array
  search now ranks Binary Search first with a likely badge, where it
  previously cleared no threshold at all.

### Expanded

- **Each pattern's topic page carries its own trend** — attempts, clean rate,
  recall rate, and the sessions that produced them. Completes a chain that
  didn't exist: mastery table → pattern → attempts → the session.
- **The bank can be ordered** five ways, including best-match once a pattern
  filter is on, and **"Pick one for me"** starts one outright.
- **Analyze keeps the problem you pasted**, with its statement and the
  ranking, so the workspace opens with the problem already written down.
- **Statements can be fetched on demand** instead of waiting for the daily job.
- **Review intervals are editable**, guarded so the table can't be made
  nonsense.
- **The streak forgives one rest day a week**, shown as a rest day rather than
  backfilled as practice. The rest of the app tells you to stop at your
  budget; the streak shouldn't punish you for it.
- **An unfinished session is offered back from the Dashboard.**

## 1.1.0 — 2026-09-23

Working through TODO.md, starting with everything that could cost you work.

### Nothing you've done gets thrown away

- **A session survives a reload.** `session` was module state and nothing
  else, so a refresh, a followed link, or a phone evicting a background tab
  discarded the timer, the typed code, the whiteboard and the pasted
  statement. It is now checkpointed and restored, including the drawing
  replayed onto the canvas. The clock excludes time the tab was closed, so
  reopening tomorrow doesn't record a nine-hour session.
- **Import is validated before it replaces anything.** It used to accept any
  JSON that parsed and apply it with `Object.assign`, so a truncated download
  or an unrelated file destroyed the whole log — and the merge left whatever
  the file omitted in place, producing a state half from each. Bad files are
  now refused with a reason, and the confirmation says what the file holds
  against what you currently have.
- **Attempts can be corrected or deleted.** They were write-once, so a wrong
  outcome skewed every statistic permanently. Editing replays the whole
  history to rebuild the box and the next date, because a box advanced one
  attempt at a time stops following from a record that can change.
- **Deleting offers an undo.** For practice history and bank entries.
  `confirm()` asks before you know what you're losing; an undo is still there
  once you've noticed.

### New

- **Each problem has its own page.** Its attempts, timings, mistake tags,
  notes and the code you wrote, reachable by clicking any problem's name.
  Previously the record the app kept was the one thing you couldn't read.
- **Sync on demand.** Settings shows when the last successful sync happened,
  with controls to pull changes from another device or retry a failed push.
- **Cmd/Ctrl+Enter** finishes a session from Reflect.

## 1.0.1 — 2026-09-23

**Fixes a session that could not be saved.**

The Reflect screen requires you to answer the pattern-recall question before
saving — retrieving it yourself is the rep, and it is the reason the step
exists. That requirement was enforced by disabling the save button and
swapping its label to an instruction.

Nothing in the stylesheet distinguished a disabled button. It rendered as a
bright, fully opaque primary button with a normal cursor, and clicking it did
nothing whatsoever: no message, no movement, no sound. A finished session with
code, timings and notes could not be saved, and there was no way to find out
why.

- The save button is never disabled now. Pressing it without an answer scrolls
  the question into view, flashes it, focuses the first option and says what it
  needs. The requirement is unchanged; it just explains itself.
- Disabled controls are visibly disabled, app-wide. That rule was simply
  missing.

**And the general case, because this was never really about one button.**

A refusal that produces no output is the same defect as an uncaught throw or
an unhandled rejection: work is lost and the interface looks fine.

- `js/errors.js` is now the one place a failure becomes something you can see.
  Uncaught errors and unhandled rejections raise a banner that stays until
  dismissed, rather than reaching only the console.
- A view that throws no longer blanks the page — the rest of the app keeps
  working and says what happened.
- Settings grows a **Recent problems** list, because on a phone there is no
  console and "something went wrong" with no detail helps nobody.
- Three other silent refusals now speak: logging a problem with no name,
  saving an empty statement, and removing a bank entry that has practice
  history.

## 1.0.0 — 2026-09-19

First version worth numbering. Everything before this was the app becoming
itself; this is the point where the whole loop works end to end and is
deployed.

### What it does

- **A guided session.** Dashboard recommends what to work, then Workspace runs
  it: problem statement, code editor and whiteboard side by side in resizable
  panes, with a timer and a "I've got my approach" marker that records time to
  insight. Submit hands off to Reflect — pattern recall, outcome, mistake tags,
  and a soul statement — and one save writes the attempt, advances the Leitner
  box, updates the streak, and records the recall as a quiz rep.
- **Spaced repetition without deadlines.** Boxes 0–5 decide when recall is
  likely fading, but nothing is ever presented as due or overdue. What's shown
  is how long since you last practiced something.
- **A problem bank.** ~2,500 pattern-labelled problems to browse and stock up
  on. Saved problems wait in the bank and are never counted against you; one
  joins the rotation the first time you actually work it.
- **Pattern analysis.** Paste an unfamiliar problem and see which of the 23
  patterns it resembles, with the exact words and input bounds that led there.
  Runs entirely in the browser.
- **A daily budget you can watch.** A start/pause clock counting down against
  the budget, with the plant growing into the day and shrinking past it.
- **The plant.** Two axes: a cumulative stage that never regresses, and a
  volatile health read on the last fortnight. Stands in the corner of every
  page but Home.
- **Learning material.** One page per pattern — hook, concept, invariant,
  pitfalls — with 46 animated worked examples across 220 frames.
- **Progress tracking.** Clean-solve rate and time-to-insight over eight weeks,
  which patterns moved, and a volume chart that names a spike rather than
  celebrating it.
- **Global search, keyboard shortcuts, a whiteboard, manual logging, a journal,
  a system-design track, and a LeetCode profile sync.**

### How it's built

- Vanilla ES modules, no build step, deployed as a static site to GitHub Pages.
- Two repos: this public app shell, and a private data repo holding your
  `state.json`, whiteboard images and fetched problem statements. The app talks
  to it through the GitHub Contents API with a token kept in your browser.
- The pattern model is trained offline on published datasets; only the weights
  ship. Explanations are faithful by construction — each contribution is the
  feature's weight times its value, not a post-hoc story.
- 314 tests, no dependencies, `node --test`.

### Known limits

- The pattern model's recall is low for technique patterns — binary search in
  particular — so a sorted-array problem can rank Arrays & Hashing above Two
  Pointers. The ranking is reliable well past where a clean yes/no cut is,
  which is why the UI shows a ranked list rather than a verdict.
- Problem statements come from a scheduled job, 20 per run, so a newly added
  problem may show its paste box for a day before its statement arrives.
- The whole state syncs as a single JSON file, which GitHub caps at 1 MB. The
  bank is capped at 500 problems and statements are stored outside it to keep
  well clear.
