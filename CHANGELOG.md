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

## 1.9.0 — 2026-09-24

### The whiteboard has tools worth having

Eight, chosen for what a coding interview needs drawn rather than what a drawing
app usually has: **select, pen, arrow, line, box, circle, text, and an
array/grid**. Each has the keyboard letter its convention already gives it.
There is no fill, no layers and no gradients, because none of them appear on a
whiteboard in front of an interviewer.

- **The array tool** is the one that earns its place. A row of boxes with index
  labels underneath is the most-drawn thing in a coding interview and the most
  tedious to produce freehand while somebody watches. It is one drag now.
- **Arrows and lines straighten by default.** The reason to reach for an arrow
  tool rather than freehand is that it comes out straight; a wobbly one between
  two boxes reads as a mistake rather than as a pointer.
- **Select, move, delete and redo** are all new. The board could previously do
  exactly one thing to a stroke: undo the most recent one.

Two bugs found while building it. Points were stored in **device pixels**, so a
diagram drawn on a retina tablet would have rendered at half scale on a laptop
and dragging the pane narrower squashed everything in it — which the handoff
shipped in 1.8.0 would have made visible immediately. And undo pushed the
inverse of the inverse, so redo re-applied the *undo*: delete a box, undo, redo,
and you had two boxes.

### Live sync between devices

A stroke now appears on the other screen as you draw it — measured at 132ms end
to end. Optional, and off unless you set a relay address in Settings.

Without a relay nothing changes: a drawing still follows you between devices in
a few seconds through your own repo, which is what 1.8.0 added. The relay only
makes it immediate, which is what two screens at once needs — a tablet beside a
laptop, or somebody watching.

`relay/server.mjs` is one file of plain Node with no dependencies, it stores
nothing, and it only ever carries the session in front of you. Your practice log
never goes near it.

### Fixed

- A session's scratch log is cleaned up when the session is saved, rather than
  accumulating one file per session forever.

---

## 1.8.0 — 2026-09-24

### Fixed, and it was live

- **Saving a session charged the day budget for it twice.** Reported from use:
  "when I submitted my soul statement, my time dropped from 30 minutes to +15
  minutes." Nothing happened in between except pressing save, and 45 minutes is
  exactly the session that had just been logged.

  `budgetProgress` added the day clock's minutes to the minutes logged against
  today's attempts. Its own comment gave the reasoning — a day where you logged
  two problems and then ran the clock for twenty minutes has used both — which
  is true, and which assumed the two can never be *the same* minutes. They are,
  whenever the clock runs during a session you then save. So the budget was
  wrong on the main path and right only on the incidental one.

  A session saved while the clock was running now says so, and its minutes are
  left to the clock that already counted them. A rep logged by hand for work
  done on paper says so too, and still counts in full.

### Two copies of the app, with separate data

- **`main` on a tag ships the live site; a `dev` branch ships `/dev/`.** There
  was one copy, deployed straight to the URL its owner practises on, sharing one
  data file and one set of browser keys — so every change was tested in
  production against real practice history, and a local build read the same
  cached state as the real thing.

  The channel comes from where the page is served, never a build step or a flag.
  Localhost is always dev. Every stored key is namespaced, including the token,
  so a dev build cannot reach a real log even in the same browser. A dev build
  says so in the header and around the window, and registers no service worker.

  A push to `main` now publishes nothing on its own. That is the point.

### A timebox per question

- **30 / 45 / 60 minutes by difficulty**, editable per difficulty, divided into
  the phases the process actually has — medium is 5 read, 15 plan, 20 code, 5
  reflect. The division is not proportional, because the process isn't:
  understanding a problem takes about five minutes whether it is easy or hard,
  and what scales with difficulty is how long you should be willing to plan
  before committing to code.

  Guardrails, not gates. Nothing stops when a phase ends; the workspace says
  where you are, nudges a minute before each boundary while there is still time
  to act on it, and counts overrun rather than hiding it.

- **The layout follows the interview, not the editor.** Reading leads with the
  problem; planning gives the whiteboard the room and opens it if it was closed;
  coding gives the editor the room and keeps the board legible beside it,
  because referencing the diagram is the reason for having drawn one. One drag
  of a splitter and the app stops moving panes for the rest of the session.

### Cross-device handoff

- **Draw on the tablet, open the laptop, the drawing is there** — and back
  again. A session is now an append-only log of identified events, persisted to
  your own repo. Stage 1 of `docs/realtime-architecture.md`; the live
  sub-second channel is stage 2.

### Cycle 7

- **A problem you keep failing is noticed.** Three failed attempts in a row used
  to reset it to box 0 so it came back tomorrow, forever, with nothing saying
  anything. The dashboard now says so and offers the pattern to read and the
  code you wrote last time, with "Try it anyway" plain and last.
- **One outcome table, one difficulty order, one clean-solve question.** Three
  hand-written copies that had stopped agreeing with the originals — which
  surfaced that `.pill-bad` never existed, because the copy had quietly
  downgraded a failure to a warning.

---

## 1.7.0 — 2026-09-24

Cycle 6 of TODO.md, found by rendering a brand-new account and reading what it
says, and by measuring the two things everyone guesses about instead.

### What a new account is told

- **A problem you have never practised is new, not neglected.** The refresher
  queue banded by days-since-practice, which is null when there is no history,
  and null fell into the oldest bucket. So the first screen a new user opened
  said they were "a month or more" behind on twenty-three problems they had
  never seen, in red — the deadline framing this app went out of its way to
  remove, surviving in the one view named after removing it. There is now a
  fourth band and it leads, because on a new account it is the whole list and
  it is where you start.

- **Pattern mastery says what it will measure, before it can measure it.** Nine
  columns, of which six are an em dash until something is logged: twenty-three
  rows of nothing formatted as data, on the page whose job is to say what to
  focus on next. Once some patterns have been worked it also names how many are
  unranked, because an untouched pattern is not a weak one and without the
  sentence a bottom-of-table position reads as a verdict.

### Measured, not assumed

- **The size warning was blaming the wrong things.** It called statements and
  code "the two that grow without limit". Measured on a realistic log at the
  limit: attempts are 80% of the file, the repeated JSON key names inside them
  are 22%, saved code 21%, and statements 7%. It now leads with attempts and
  says the one thing that actually helps.

- **`npm run measure`** answers "is it slow?" and "how big does this get?".
  Both had been answered by writing a throwaway script and deleting it. The
  answers: 6,400 attempts cost about 18 ms of logic per dashboard render, so
  there is no performance problem to solve; and a realistic log fits at 300
  problems / 1,800 attempts and is over at 400 / 3,200 — two or three years
  away, and a hard wall rather than a slope.

### Keyboard and screen reader

- **Navigating puts the cursor at the top of what you navigated to.** The app
  announced each new view into a live region and never moved focus there, so
  after `g q` the cursor sat on a nav button the re-render had replaced, focus
  fell to `<body>`, and the next Tab started from the top of the document.
  `#view-root` had carried `tabindex="-1"` for exactly this since it was
  written. It never steals focus from a field being typed in.

- **The plant is tested as drawn.** Which found that an unrecognised vitality
  fell back for the palette but not for the class name — a correct-looking
  plant in a frame that had silently lost its colour.

---

## 1.6.0 — 2026-09-24

Cycle 5 of TODO.md, found by probing the app rather than reading it. The first
item is a data-loss path that was reproduced in a browser before a line was
changed.

### Losing work

- **Work done offline was discarded on the next open.** The scenario this app
  is built for: a phone with no signal, a problem worked, the save fails, the
  work goes to localStorage, the tab closes. On the next open `init()` fetched
  the remote, adopted it, and overwrote the cache — the cached copy was read
  only when the fetch *failed*. `dirty` lived in memory and did not survive the
  reload, so nothing even knew there had been anything to keep. An hour of
  practice, gone, with the app working exactly as written.

  A reopen now finds that work and pushes it, and says so, because a silent
  save is indistinguishable from nothing having been at stake. When both sides
  hold attempts the other has never seen it goes to the conflict screen, which
  already exists to show what each choice discards.

- **A fetched problem statement never persisted.** It was assigned straight
  onto the problem object — the same object that lives in state — so it changed
  the app's data without going through `mutate`. Never cached, never synced,
  gone when the tab closed, and fetched again next session. Whether it survived
  depended on whether some unrelated mutation happened to write the cache
  afterwards.

### Trusting less

- **The sync path checks what it loads.** `inspectImport` had guarded the
  import path since it was written; the path that runs every single time the
  app opens trusted whatever came back, and `migrateState` only backfills
  missing keys. A truncated write or a hand edit went straight into the views.
  A file that cannot be read is deliberately *not* reported as offline —
  offline means carry on and save later, and saving later would overwrite the
  damaged file that is the only evidence left of what it held. It blocks
  saving, shows your cached copy, and names the path to go and open.

### Finding and correcting things

- **Search finds journal entries.** Soul statements were made findable in
  1.5.0; weekly retros are the harder thing to find again, being loose prose in
  a list that only grows. The ranking also moved out of `runSearch` into a pure
  `collectResults`, so what is findable is finally a testable question.

- **Today's clock can be corrected.** It feeds the budget ring and the plant's
  health and could only run or pause. The correction is stored apart from the
  reading, with an undo, so the clock keeps what it measured and the correction
  stays visible as one. It will not drive the day below zero, and it will not
  subtract time that has not elapsed.

- **A statement says where it came from** — fetched or pasted, with the date —
  and can be replaced, which is the only way back from one synced against the
  wrong problem.

### Knowing where you stand

- **A session shows what you did last time**, split by what it gives away. The
  outcome, the timings and the mistakes you tagged lead: "off by one, edge case
  missed" is a thing to watch for. Your note is not — "the window only shrinks
  from the left" is the answer written down — so it joins the code behind the
  same closed fold.

- **Your record on a pattern is in its topic header**, one line, instead of
  only at the bottom below two diagrams and a practice ladder.

- **One list keyboard, applied to every list.** The bank had arrow keys and
  nothing else did, because the bank kept a private copy. Home and End are new.

### Fixed

- `scripts/check-views.mjs` joins `npm run check`: forty render calls, each
  view against an empty log and a populated one. Loading a module proves its
  imports resolve and says nothing about whether its render body runs, which is
  the failure that reaches people — a view nobody opens during a test run is
  first opened by the user.
- The pattern-history empty state predated 1.5.0's rule that every empty state
  offers the way out of it, and the audit missed it because it did not use the
  shared helper.
- A correction of `-0` minutes could render as "-0 min".

---

## 1.5.0 — 2026-09-24

Cycle 4 of TODO.md. Both of the P0s turned out to be the same shape: the app
already held the answer and had never looked at it.

### Things it knew and never said

- **The model is graded on your problems.** It ships with numbers from a
  held-out split of a public corpus, which say how it does on problems in
  general and nothing about how it does on the ones you paste in. Analyze had
  been writing its ranking onto every problem tracked from it since the
  feature shipped, and the problem then records which pattern it settled on.
  Nothing had ever compared the two. Analyze now ends with how often its
  ranking held your answer — called *agreement*, not accuracy, because you
  pick the pattern on the same form that just showed you the guess, and
  nothing here can tell a correct model from an anchored user. The overrules
  carry no such doubt, so those are listed by name with how sure it was.
  Below eight problems it reports no percentage and says how many more it
  needs.

- **A week in review.** The progress charts answer "am I improving" over
  twelve weeks and refuse on principle to say anything about a single week.
  Right, and it left no answer to the question you actually have on a Sunday:
  what did I do. Progress now leads with the last seven days — sessions, days
  worked, what moved up a box, every problem with its outcome, every note you
  wrote — exportable as Markdown. The clean-solve rate disappears below three
  attempts, minutes count only sessions that were actually timed and say so,
  and the comparison with last week is a fact rather than praise or reproach.

- **The quiz reports your own confusions.** It kept a lifetime score and threw
  away which pattern you reached for instead — the only part that could change
  what you study. It now names the pairs you have mixed up more than once, and
  links to the one to read. Once is a slip; twice is a habit.

- **Mocks report what they were for.** Five interview behaviours recorded on
  every mock, never read again; `state.mocks` fed one ring. The Journal now
  says how your last ten went per behaviour and names the one to work on.

### Structure and consistency

- **views.js split five ways** — chrome.js, setup-view.js, drill-view.js,
  settings-view.js, detail-view.js — from 2,534 lines to 1,032. It also stops
  being a door: every module that imported `esc` or `startSession` through it
  now names the module those live in.

- **One rule for destroying things.** There had been three: an undo for some
  removals, silent deletion for a resource link, a bare `confirm()` for
  disconnecting, and three different wordings for leaving a session. Now:
  removing one item from a list happens and offers an undo; anything the app
  cannot undo afterwards asks first, and says what is lost *and* what
  survives.

- **Settings in sections**, with anything wrong sitting above them unheaded.

- **Every empty state offers the way out of it.** Four of eight had no action
  at all, because the helper could only navigate and their answer was on the
  same page. It now also takes a field to focus.

### Fixed

- A dead `.link-button` rule, defined twice with conflicting intent and
  shadowed since it was written.
- `scripts/check-references.mjs` joins `npm run check`. Splitting views.js
  left `OUTCOME_GLYPH` used in two files and imported by neither — every
  module loaded, all 577 tests passed, and the Journal threw on open. Loading
  a module only proves its imports resolve.

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
