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
