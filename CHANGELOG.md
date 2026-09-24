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

## 1.4.0 — 2026-09-24

Cycle 3 of TODO.md. The theme, unplanned but consistent across the eight
items: the app knew more than it was willing to say.

### The app explains itself

- **A first run says what any of this is for.** A new account landed on a
  dashboard with a plant, a budget ring, a recommendation and a 23-pattern
  taxonomy and no indication what they were. The reasoning existed — in source
  comments and this changelog, where nobody looks. Four screens now say it
  once: skippable, never shown again, and the flag is per-device rather than
  in the synced state, because it describes this browser and not you.

- **The plant shows its working.** It said "stressed" and listed signals, but
  the arithmetic from signals to that word lived only in the source. It can
  now show what specifically moved it, as contributions that sum to the number
  displayed — the same faithful-by-construction rule the pattern model's
  explanations follow, rather than a story told about a number computed
  elsewhere. A contribution of zero is never listed; a row reading "+0" is
  noise dressed as evidence.

- **Offline says what it means for you.** "Offline — showing cached data"
  didn't answer the only two questions worth asking: did my last session make
  it, and what happens if I keep working. It now says both, and says what will
  happen when the connection returns.

- **Every chart states its own content.** The line charts already carried a
  sentence summary; the volume bars and mastery rings carried `title`
  attributes, which most screen readers ignore. They now read the way the line
  charts do.

### Finding and keeping your own work

- **Search covers your notes.** Soul statements are what this app works
  hardest to collect — "the window only shrinks from the left" — and there was
  no way to find one again. Search now finds them and says which session each
  came from.

- **One problem's history exports on its own.** The whole-log export exists to
  move your data; it is the wrong thing to hand someone who asked how a
  problem went. A single problem now exports as Markdown: the prediction you
  made going in, then every attempt oldest-first with its timings, mistakes,
  note and code.

### Recording what actually happened

- **"Ran out of time" is its own outcome.** Running out of time on a hard
  problem you understood is not the same as not getting it, and collapsing
  them made the clean-solve rate say less than it could. It moves you back a
  box rather than resetting you to the start. Attempts recorded before this
  are unaffected.

### Structure

- **logic.js split.** It had grown to 1,254 lines holding scheduling, the
  plant, planning, stats, progress, the day clock, refresher framing, import
  validation, the size guard, mock phases and quiz weighting — becoming what
  views.js had been. Now `stats.js`, `state-health.js` and `session-store.js`
  alongside it, along the same seams and with no behaviour change. The line
  that decided each call: logic keeps what it reasons with, stats keeps what
  it draws.

---

## 1.3.0 — 2026-09-24

Cycle 2 of TODO.md — drawn from what came up while building cycle 1.

### Safety

- **The sync payload is watched.** The whole log goes to GitHub as one file
  with a 1 MB limit, and crossing it fails every save at once. Settings now
  shows the footprint past 70%, broken down by what's taking the room, and a
  save that would exceed the limit is refused with an explanation rather than
  a raw API error.
- **Failed saves retry themselves** on a backoff, and immediately on
  reconnecting. Previously a failure sat until your next edit happened to
  trigger a save — close the tab in between and the only copy was local.

### The loop keeps more of what you do

- **Your previous code** is offered in the workspace, behind a reveal, so
  coming back to a problem after a month can show what you did last time
  without spoiling the attempt.
- **Whiteboards from a session** appear on that problem's page.
- **Heatmap days open**, showing what you worked, wrote and drew.
- **The quiz is weighted** by what's fading and what you've misidentified
  before, instead of picking uniformly at random inside an app built on a
  spacing algorithm.

### Practice feels like practice

- **A mock interview counts down from 45 minutes** and walks its phases —
  clarify, state the approach, narrate, state complexity, test — arriving when
  they'd matter rather than sitting in a list. Running over shows as a
  negative rather than quietly stopping.
- **The bank works from the keyboard**: arrows move, Enter starts.

### Inside

- **views.js split** from 3,300 lines into `ui.js` (shared primitives) and
  `session-view.js` (the guided path, 843 lines). No behaviour change.

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
