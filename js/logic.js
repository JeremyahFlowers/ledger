// Pure functions: spaced repetition, daily budget planning, pattern analytics,
// streaks, system-design unlock. No DOM, no network — easy to reason about and
// easy to extend as the system grows.

export function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function addDaysISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

export function daysBetween(aISO, bISO) {
  const [ay, am, ad] = aISO.split("-").map(Number);
  const [by, bm, bd] = bISO.split("-").map(Number);
  const a = new Date(ay, am - 1, ad);
  const b = new Date(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}

export const MISTAKE_TAGS = [
  "misread-problem",
  "wrong-pattern-id",
  "edge-case-missed",
  "implementation-bug",
  "time-management",
  "forgot-technique",
  "off-by-one",
  "complexity-misjudged",
  "communication",
  "other",
];

/** Counts practice "events" per calendar date across attempts, mocks, and
 * system design sessions — the data a GitHub-style activity heatmap needs. */
export function activityByDate(state) {
  const counts = {};
  const bump = (date) => {
    if (date) counts[date] = (counts[date] || 0) + 1;
  };
  allAttempts(state).forEach((a) => bump(a.date));
  state.mocks.forEach((m) => bump(m.date));
  state.systemDesign.sessions.forEach((s) => bump(s.date));
  return counts;
}

/** Rolling solved-clean rate over a pattern's last N attempts, oldest to
 * newest — what a trend sparkline draws, so a pattern that's recently
 * improving doesn't get buried by a bad all-time average. */

export function patternStats(state) {
  return state.patterns.map((pat) => {
    const attempts = allAttempts(state, pat.id);
    const n = attempts.length;
    const solvedClean = attempts.filter((a) => a.outcome === "solved-clean").length;
    const guessedCorrect = attempts.filter((a) => a.patternGuess === "correct").length;
    const times = attempts.map((a) => a.timeToInsightMin).filter((t) => typeof t === "number" && !Number.isNaN(t));
    const avgInsight = times.length ? times.reduce((s, t) => s + t, 0) / times.length : null;
    const mistakeFreq = {};
    attempts.forEach((a) => (a.mistakeTags || []).forEach((t) => (mistakeFreq[t] = (mistakeFreq[t] || 0) + 1)));
    const topMistake = Object.entries(mistakeFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return {
      pattern: pat,
      problemCount: state.problems.filter((p) => p.patternId === pat.id).length,
      attempts: n,
      solvedCleanRate: n ? solvedClean / n : null,
      patternGuessRate: n ? guessedCorrect / n : null,
      avgInsightMin: avgInsight,
      topMistake,
    };
  });
}


// Re-exported from stats.js and state-health.js, where these now live.
export {
  patternTrend,
  PROGRESS_WEEKS, weeklyProgress, patternMovement, progressSummary,
  SCORECARD_MIN, modelScorecard,
  REVIEW_DAYS, weekInReview, CONFUSION_MIN, quizConfusions,
  MOCK_WINDOW, MOCK_MIN, mockReview,
} from "./stats.js";

// Re-exported from state-health.js, where these now live. Everything already
// imports them from here, and a split that forces every caller to be rewritten
// is a split that gets abandoned halfway.
export {
  SYNC_LIMIT_BYTES, SYNC_WARN_FRACTION, syncFootprint, formatBytes,
  inspectImport, describeState, compareStates,
} from "./state-health.js";

// ---------- Mock interviews ----------
//
// A mock used to be an ordinary session with a pill on it and five prompts
// listed in a box. Nothing about it felt different from practising alone,
// which is the entire point of practising one: the pressure, the clock you
// cannot quietly ignore, and the habit of saying what you are doing before
// you do it.
//
// So a mock now has a shape. The same five things the checklist always asked
// for, but arriving when they would actually matter in a real interview,
// against a clock that runs down rather than up.

/** A standard technical screen. Long enough to be realistic, short enough to
 * be a constraint. */
export const MOCK_MINUTES = 45;

/**
 * The phases of a mock, as fractions of the whole.
 *
 * Fractions rather than fixed minutes so a shorter or longer mock keeps its
 * proportions — the point of "state your approach before coding" is that it
 * comes early, not that it comes at minute five.
 */
export const MOCK_PHASES = [
  { until: 0.12, label: "Clarify",  prompt: "Ask about constraints and edge cases before writing anything." },
  { until: 0.22, label: "Approach", prompt: "Say your approach out loud, and why, before you start typing." },
  { until: 0.75, label: "Code",     prompt: "Keep narrating — say what you're doing and the trade-offs you're making." },
  { until: 0.88, label: "Complexity", prompt: "State the time and space complexity without being asked." },
  { until: 1.00, label: "Test",     prompt: "Walk an example through your code before you call it done." },
];

/**
 * Which phase a mock is in, and how long is left.
 *
 * `overrun` rather than clamping at zero: running over is information, and an
 * interview that quietly stops counting teaches the opposite of the lesson.
 */
export function mockPhase(elapsedMin, totalMin = MOCK_MINUTES) {
  const fraction = totalMin > 0 ? elapsedMin / totalMin : 0;
  const remainingMin = totalMin - elapsedMin;
  const phase = MOCK_PHASES.find((p) => fraction <= p.until) || MOCK_PHASES[MOCK_PHASES.length - 1];
  return {
    index: MOCK_PHASES.indexOf(phase),
    label: phase.label,
    prompt: phase.prompt,
    remainingMin,
    fraction,
    overrun: remainingMin < 0,
    // The last few minutes of an interview feel different from the middle,
    // and the UI should too.
    urgent: remainingMin <= totalMin * 0.15,
  };
}

export const MOCK_CHECKLIST = [
  "Clarified constraints & edge cases before coding",
  "Stated approach out loud before typing",
  "Narrated trade-offs while coding",
  "Stated time/space complexity unprompted",
  "Tested with an example before declaring done",
];

// How a session ended, in one table.
//
// This used to be five separate lists — two <select>s, a glyph map, a label
// map and a pair of if-chains in the scheduler — which is four chances for a
// new outcome to be half-added.
//
// "Ran out of time" exists because "failed" was doing too much work. Not
// finishing a hard problem you understood is not the same as not getting it,
// and collapsing them made the clean-solve rate say less than it could. It
// steps back one box rather than resetting: you didn't finish, so you lose
// ground, but not all of it.
export const OUTCOMES = [
  { value: "solved-clean",     label: "Solved clean",      symbol: "✓", cls: "outcome-good", box: "up" },
  { value: "solved-struggled", label: "Solved, struggled", symbol: "~", cls: "outcome-warn", box: "hold" },
  { value: "ran-out-of-time",  label: "Ran out of time",   symbol: "⏱", cls: "outcome-warn", box: "back" },
  { value: "failed",           label: "Didn't solve",      symbol: "✕", cls: "outcome-bad",  box: "reset" },
];

/** The box after an outcome, given where it was. One place, so the scheduler
 * and the replay in recomputeSchedule cannot disagree. */
export function nextBox(box, outcome, intervalCount) {
  const effect = OUTCOMES.find((o) => o.value === outcome)?.box || "hold";
  if (effect === "up") return Math.min(box + 1, intervalCount - 1);
  if (effect === "reset") return 0;
  if (effect === "back") return Math.max(0, box - 1);
  return box;
}

/** Leitner-style box scheduling. Mutates `problem` in place. */
export function applyOutcome(problem, outcome, settings) {
  const intervals = settings.boxIntervalsDays;
  const box = nextBox(problem.box || 0, outcome, intervals.length);
  problem.box = box;
  problem.nextReviewDate = addDaysISO(todayISO(), intervals[box]);
}

/**
 * Rebuild a problem's box and next date by replaying its whole history.
 *
 * applyOutcome advances the box one attempt at a time, which is right while
 * attempts only ever arrive. The moment one can be corrected or removed, an
 * incrementally-built box no longer follows from the record it claims to
 * summarise — delete the failure that reset you to box 0 and the schedule
 * still believes it happened.
 *
 * Replaying is cheap (a handful of attempts) and leaves no way for the two to
 * disagree, so editing routes through here rather than trying to undo a step.
 */
export function recomputeSchedule(problem, settings) {
  const intervals = settings.boxIntervalsDays;
  const history = [...(problem.attempts || [])].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  let box = 0;
  for (const attempt of history) {
    box = nextBox(box, attempt.outcome, intervals.length);
  }
  problem.box = box;

  // Scheduled from the last attempt rather than from today: the interval
  // measures time since you last worked it, and a correction made weeks later
  // must not quietly push the next refresher weeks further out.
  const last = history[history.length - 1];
  problem.nextReviewDate = last ? addDaysISO(last.date, intervals[box]) : todayISO();
  return problem;
}

/**
 * Remove one attempt and bring the schedule back in line with what is left.
 *
 * Returns the removed attempt so a caller can offer to put it back.
 */
export function removeAttempt(problem, attemptId, settings) {
  const removed = (problem.attempts || []).find((a) => a.id === attemptId) || null;
  problem.attempts = (problem.attempts || []).filter((a) => a.id !== attemptId);
  recomputeSchedule(problem, settings);
  return removed;
}

/** Fields an edit is allowed to change. Anything else about an attempt is a
 * record of what happened and is not up for revision. */
const EDITABLE_ATTEMPT_FIELDS = ["outcome", "patternGuess", "timeToInsightMin", "timeToSolveMin", "mistakeTags", "soulStatement"];

/** Apply a correction to one attempt, then replay the schedule. */
export function editAttempt(problem, attemptId, changes, settings) {
  const attempt = (problem.attempts || []).find((a) => a.id === attemptId);
  if (!attempt) return null;
  for (const field of EDITABLE_ATTEMPT_FIELDS) {
    if (field in changes) attempt[field] = changes[field];
  }
  recomputeSchedule(problem, settings);
  return attempt;
}

// A saved problem is in one of two states, and the difference is the whole
// reason a large problem bank doesn't wreck the review schedule:
//
//   active   in the spaced-repetition rotation — the schedule tracks how long
//            since you worked it, which is a signal that means something.
//   backlog  collected but not started. Never surfaced as needing anything,
//            never counted against you.
//
// Without this split, saving 300 problems from the bank would surface all 300
// at once, and a week later the plant would read 300 neglected problems and wilt —
// turning a healthy act (stocking up on practice material) into the exact
// burnout signal the plant exists to warn about. A problem becomes active the
// first time you actually work it.
export const STATUS_ACTIVE = "active";
export const STATUS_BACKLOG = "backlog";

/** States written before this field existed hold active problems only. */
export function isBacklog(problem) {
  return problem.status === STATUS_BACKLOG;
}

export function dueProblems(state) {
  const today = todayISO();
  return state.problems
    .filter((p) => !isBacklog(p))
    .filter((p) => !p.nextReviewDate || p.nextReviewDate <= today)
    .sort((a, b) => a.box - b.box || (a.nextReviewDate || "").localeCompare(b.nextReviewDate || ""));
}

export function backlogProblems(state, patternId = null) {
  return state.problems
    .filter(isBacklog)
    .filter((p) => !patternId || p.patternId === patternId);
}

/** Moves a bank problem into the rotation. Called when a session is saved
 * against it, so working a problem is what schedules it. */
export function activateProblem(problem) {
  if (!isBacklog(problem)) return;
  problem.status = STATUS_ACTIVE;
  if (!problem.nextReviewDate) problem.nextReviewDate = todayISO();
}

// A problem statement is the user's own pasted copy, kept in their private
// repo. The app ships no statement text of its own: the catalog carries titles,
// difficulties and pattern labels, which are facts about a problem, not the
// problem's prose.
//
// The cap exists because the whole state is one JSON file synced through the
// GitHub Contents API, which refuses anything over 1 MB. A statement runs
// 1-3 KB, so a few hundred of them is a real fraction of that budget; 12 KB is
// far more than any single statement needs and still bounds the worst case.
export const MAX_STATEMENT_CHARS = 12000;

/**
 * Prepare a pasted statement for storage.
 *
 * Reports truncation rather than silently cutting the text, so the UI can say
 * so — finding out that the bottom of a problem is missing halfway through
 * solving it would be worse than being told up front.
 */
export function normalizeStatement(text) {
  const trimmed = String(text ?? "").replace(/\r\n/g, "\n").trim();
  return {
    text: trimmed.slice(0, MAX_STATEMENT_CHARS),
    truncated: trimmed.length > MAX_STATEMENT_CHARS,
  };
}

/** Greedily fills today's budget with the weakest patterns and the problems
 * left longest first, so a 75-minute day never silently drops what matters
 * most. Whatever doesn't fit simply waits — see the refresher block above for
 * why nothing here is framed as late. */
export function planToday(state) {
  const due = dueProblems(state);
  const budget = state.settings.dailyBudgetMin;
  const est = state.settings.estimateMinByDifficulty;
  let used = 0;
  const plan = [];
  const overflow = [];
  for (const p of due) {
    const cost = est[p.difficulty] ?? est.Unrated ?? 30;
    if (plan.length === 0 || used + cost <= budget) {
      plan.push(p);
      used += cost;
    } else {
      overflow.push(p);
    }
  }
  return { plan, overflow, usedMin: used, budgetMin: budget };
}

export function allAttempts(state, patternId) {
  const problems = patternId ? state.problems.filter((p) => p.patternId === patternId) : state.problems;
  const out = [];
  for (const p of problems) {
    for (const a of p.attempts) {
      out.push({ ...a, problemId: p.id, problemName: p.name, patternId: p.patternId });
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}


// One missed day per week is forgiven. The rest of this app spends its effort
// telling people to stop at their budget, that a lighter week is a good
// outcome, and that a volume spike is the shape that precedes quitting — and
// then reset a forty-day streak to 1 for taking a single Sunday off. That is
// the loudest number on the dashboard contradicting everything around it.
//
// One per rolling week, not unlimited: a streak that survives any gap is not
// measuring anything. And a used grace day is shown as a grace day rather
// than backfilled as practice, because the streak has to stay something the
// record can support.
export const STREAK_GRACE_DAYS_PER_WEEK = 1;
const GRACE_WINDOW_DAYS = 7;

/** Grace days spent in the week ending `today`. */
function recentGraceUsed(streak, today) {
  return (streak.graceDays || []).filter((d) => daysBetween(d, today) < GRACE_WINDOW_DAYS).length;
}

export function updateStreak(state) {
  const today = todayISO();
  const streak = state.streak;
  if (!Array.isArray(streak.graceDays)) streak.graceDays = [];
  if (streak.lastActiveDate === today) return;

  const gap = streak.lastActiveDate ? daysBetween(streak.lastActiveDate, today) : null;

  // Keep only the grace days still inside the window, so the allowance
  // genuinely renews rather than accumulating a record of every one ever used.
  streak.graceDays = streak.graceDays.filter((d) => daysBetween(d, today) < GRACE_WINDOW_DAYS);

  if (gap === 1) {
    streak.current += 1;
  } else if (gap === 2 && recentGraceUsed(streak, today) < STREAK_GRACE_DAYS_PER_WEEK) {
    // Exactly one day missed, and an allowance left to cover it. The missed
    // day is recorded, not the practice.
    streak.graceDays.push(addDaysISO(streak.lastActiveDate, 1));
    streak.current += 1;
  } else {
    streak.current = 1;
    streak.graceDays = [];
  }
  streak.longest = Math.max(streak.longest || 0, streak.current);
  streak.lastActiveDate = today;
}

/** Whether a grace day is currently holding the streak together, for the UI
 * to say so honestly rather than implying an unbroken run. */
export function streakGraceInfo(state, today = todayISO()) {
  const streak = state.streak || {};
  const used = (streak.graceDays || []).filter((d) => daysBetween(d, today) < GRACE_WINDOW_DAYS);
  return {
    used: used.length,
    allowance: STREAK_GRACE_DAYS_PER_WEEK,
    remaining: Math.max(0, STREAK_GRACE_DAYS_PER_WEEK - used.length),
    dates: used,
  };
}

export function systemDesignUnlock(state) {
  const { minMocks, minSolvedCleanRate } = state.settings.systemDesignUnlockThreshold;
  const recent = state.mocks.slice(-10);
  const rate = recent.length ? recent.filter((m) => m.outcome === "solved-clean").length / recent.length : 0;
  const meetsAuto = state.mocks.length >= minMocks && rate >= minSolvedCleanRate;
  return {
    unlocked: state.systemDesign.manualUnlock || meetsAuto,
    manualUnlock: state.systemDesign.manualUnlock,
    mocksLogged: state.mocks.length,
    minMocks,
    recentSolvedCleanRate: rate,
    minSolvedCleanRate,
  };
}

/**
 * The most recent attempt on a problem that recorded code, or null.
 *
 * Used by the workspace to offer your last solution *after* you've had your
 * own attempt. Spaced repetition on something you solved a month ago is
 * exactly when seeing what you did last time is worth the most — and exactly
 * when showing it up front would destroy the rep.
 */
export function lastAttemptWithCode(problem) {
  const withCode = (problem?.attempts || []).filter((a) => a.code && a.code.trim());
  if (!withCode.length) return null;
  return withCode.reduce((latest, a) => ((a.date || "") >= (latest.date || "") ? a : latest), withCode[0]);
}

/**
 * What you did last time on this problem — the part that is safe to show.
 *
 * Reopening a problem you failed last week gave you the statement and an empty
 * editor. Your old code was already here behind a `<details>`, deliberately
 * shut, because handing you your own solution before you have tried is the one
 * thing this app exists to prevent.
 *
 * The same reasoning splits the rest in two, and the split is the whole point
 * of this function. What you *scored* — the outcome, how long it took, which
 * mistakes you tagged — tells you what to watch for without telling you the
 * approach, so it leads. "Last time: off by one, edge case missed" is a warning.
 * Your soul statement is not: "the window only shrinks from the left" is the
 * answer written down, so it stays behind the same closed door as the code.
 *
 * Returns null when there is no previous attempt, so a first rep shows nothing
 * rather than an empty frame.
 */
export function priorAttemptSummary(problem) {
  const attempts = (problem?.attempts || []).filter((a) => a.date);
  if (!attempts.length) return null;
  const last = attempts.reduce((latest, a) => (a.date >= latest.date ? a : latest), attempts[0]);
  return {
    date: last.date,
    attemptNumber: attempts.length,
    outcome: last.outcome,
    timeToInsightMin: typeof last.timeToInsightMin === "number" ? last.timeToInsightMin : null,
    timeToSolveMin: typeof last.timeToSolveMin === "number" && last.timeToSolveMin > 0
      ? last.timeToSolveMin : null,
    mistakeTags: Array.isArray(last.mistakeTags) ? last.mistakeTags : [],
    recalledPattern: last.patternGuess === "correct",
    // Behind the same door as the code, and named here only so the view knows
    // whether the door is worth showing.
    note: last.soulStatement || "",
    hasCode: !!(last.code && last.code.trim()),
  };
}

// ---------- Box intervals ----------
//
// boxIntervalsDays decides when each box comes back round, and was honoured
// everywhere while being changeable only by hand-editing JSON. It is the one
// number that defines what this app *is*, so it should be adjustable — and
// guarded, because a bad table is not a bad setting, it is a schedule that
// stops working.

export const MIN_BOX_INTERVALS = 3;
export const MAX_BOX_INTERVALS = 8;
export const MAX_BOX_INTERVAL_DAYS = 365;

/**
 * Check a proposed interval table.
 *
 * Must be non-decreasing: the whole premise is that each box waits longer than
 * the last, and a table that dips would send a problem you just solved cleanly
 * back sooner than one you struggled with.
 */
export function validateBoxIntervals(values) {
  const errors = [];
  if (!Array.isArray(values) || values.length < MIN_BOX_INTERVALS) {
    return { ok: false, errors: [`Needs at least ${MIN_BOX_INTERVALS} boxes.`], values: [] };
  }
  if (values.length > MAX_BOX_INTERVALS) {
    errors.push(`More than ${MAX_BOX_INTERVALS} boxes is more schedule than anyone needs.`);
  }
  if (values.some((n) => !Number.isInteger(n) || n < 0)) {
    errors.push("Every interval must be a whole number of days, zero or more.");
  }
  if (values.some((n) => n > MAX_BOX_INTERVAL_DAYS)) {
    errors.push(`Nothing should wait longer than ${MAX_BOX_INTERVAL_DAYS} days.`);
  }
  if (values[0] !== 0) {
    errors.push("The first box must be 0 days — a problem you just failed comes back today.");
  }
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1]) {
      errors.push("Each box must wait at least as long as the one before it.");
      break;
    }
  }
  return { ok: errors.length === 0, errors, values };
}

/** Parse a comma-separated interval list from a text field. */
export function parseBoxIntervals(text) {
  return String(text ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => (/^\d+$/.test(part) ? Number(part) : NaN));
}

// ---------- Refreshers, not deadlines ----------
//
// The scheduling underneath is unchanged — Leitner boxes still decide when
// recall is likely to be fading, and that's a real signal worth acting on.
// What changed is what gets said about it.
//
// This used to be presented as a deadline: "due today", "12d overdue", a red
// band labelled "slipping". Nobody is owed this work, and a problem you set
// down three weeks ago isn't a missed obligation — it's just a thing you
// haven't looked at in three weeks. Deadline language turns an ordinary gap
// into a debt, and a growing pile of debts is the thing people quit over.
//
// So the number on screen is now how long since you last practiced it, which
// is a fact about what you did rather than a judgment about what you owe, and
// the suggestion is a refresher rather than a reckoning.

/** The date a problem was last actually worked, or null if it never has been. */
export function lastPracticedISO(problem) {
  if (!problem.attempts?.length) return null;
  return problem.attempts.reduce((latest, a) => (a.date > latest ? a.date : latest), problem.attempts[0].date);
}

/** Past roughly a week beyond its interval, recall has usually drifted far
 * enough to be worth saying something about. */
export const FADING_DAYS = 7;

/**
 * What to say about a problem's recency.
 *
 * `tone` still comes from the schedule, because the schedule is what knows
 * when recall fades — it just drives emphasis now rather than a scolding.
 */
export function refresherStatus(problem, today = todayISO()) {
  const last = lastPracticedISO(problem);
  const daysSince = last ? daysBetween(last, today) : null;
  const pastInterval = problem.nextReviewDate ? daysBetween(problem.nextReviewDate, today) : 0;

  let tone = "fresh";
  if (!last) tone = "new";
  else if (pastInterval >= FADING_DAYS) tone = "fading";
  else if (pastInterval >= 0) tone = "ready";

  return { last, daysSince, pastInterval, tone, text: recencyText(daysSince) };
}

/**
 * A gap in words.
 *
 * Coarser as it grows, because the difference between 38 and 41 days isn't
 * information — and an exact day count that far back reads as a tally being
 * kept against you.
 */
export function recencyText(days) {
  if (days == null) return "not practiced yet";
  if (days === 0) return "practiced today";
  if (days === 1) return "practiced yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `${weeks} weeks ago`;
  }
  // The weeks branch runs to 59 days, so this is only ever reached at two
  // months or more — no need to special-case a singular "1 month".
  return `${Math.round(days / 30)} months ago`;
}

// ---------- The daily budget, as a live clock ----------
//
// The budget was only ever used two ways: planToday() stops filling the day's
// plan once it's spent, and computePlantState() docks health after the fact if
// a day ran past 1.5x it. Both look at attempts already logged, so the number
// only meant anything in hindsight — you found out you'd overdone it the next
// time you opened the app.
//
// This makes it a clock you can watch while you work. It is deliberately a
// separate thing from the session timer in the workspace: that one measures
// one problem for the record, this one measures the day against the ceiling
// you set for yourself, and it keeps running between problems.

/** A day's timer, fresh. Kept per-day so yesterday's total never leaks into
 * today — the date is stored alongside rather than the timer being cleared by
 * something that has to remember to run at midnight. */
export function newDayTimer(dateISO = todayISO()) {
  // `adjustmentMs` is kept apart from `accumulatedMs` on purpose. The clock's
  // own reading stays exactly what it measured, and a correction stays
  // visible as a correction — a single merged number would quietly become the
  // thing you remember editing and stop being either.
  return { date: dateISO, running: false, startedAt: null, accumulatedMs: 0, adjustmentMs: 0 };
}

/**
 * Milliseconds on the clock today, including the stretch currently running.
 *
 * `now` is a parameter rather than read from the clock so this can be tested
 * and so a render can pass a single consistent instant to everything it draws.
 */
export function dayTimerElapsedMs(state, now = Date.now()) {
  const timer = state.dayTimer;
  if (!timer || timer.date !== todayISO()) return 0;
  // `!= null` rather than a truthiness check: a startedAt of 0 is a real
  // instant, and treating it as "never started" silently reports an empty day.
  const open = timer.running && timer.startedAt != null ? Math.max(0, now - timer.startedAt) : 0;
  // Never negative: a correction larger than the clock means "none of this
  // was practice", which is zero, not a debt carried into tomorrow.
  return Math.max(0, timer.accumulatedMs + open + (timer.adjustmentMs || 0));
}

/** Start today's clock. Rolls over to a new day's timer if the stored one is
 * stale, so the first start after midnight begins at zero. */
export function startDayTimer(state, now = Date.now()) {
  const today = todayISO();
  if (!state.dayTimer || state.dayTimer.date !== today) state.dayTimer = newDayTimer(today);
  if (state.dayTimer.running) return;
  state.dayTimer.running = true;
  state.dayTimer.startedAt = now;
}

/** Stop the clock, banking the stretch that was running. */
export function stopDayTimer(state, now = Date.now()) {
  const timer = state.dayTimer;
  if (!timer || !timer.running) return;
  timer.accumulatedMs += timer.startedAt != null ? Math.max(0, now - timer.startedAt) : 0;
  timer.running = false;
  timer.startedAt = null;
}

export function resetDayTimer(state) {
  state.dayTimer = newDayTimer();
}

/**
 * Add or subtract minutes from today's clock.
 *
 * The clock is the input to the budget ring and to the plant's health, and it
 * could not be corrected: leave it running over lunch and the day was spent,
 * with no way to say otherwise. A number you cannot correct is a number you
 * stop trusting, and then stop looking at — which would cost more than the
 * wrong forty minutes did.
 *
 * Returns the correction actually applied, which is not always the one asked
 * for: subtracting an hour from a twenty-minute day removes twenty minutes,
 * because the rest never happened.
 */
export function adjustDayTimer(state, deltaMin, now = Date.now()) {
  const today = todayISO();
  if (!state.dayTimer || state.dayTimer.date !== today) state.dayTimer = newDayTimer(today);
  const timer = state.dayTimer;

  const before = dayTimerElapsedMs(state, now);
  const wanted = Math.round(deltaMin * 60000);
  // Clamped against the total, not against the adjustment, so two successive
  // corrections can't drive the reported time below zero between them.
  const applied = Math.max(wanted, -before);
  timer.adjustmentMs = (timer.adjustmentMs || 0) + applied;
  // `|| 0` normalises -0, which is what Math.max produces when it clamps a
  // subtraction to nothing, and which would render as "-0 min".
  return applied / 60000 || 0;
}

/** The running correction on today's clock, in minutes. Zero when untouched. */
export function dayTimerAdjustmentMin(state) {
  const timer = state.dayTimer;
  if (!timer || timer.date !== todayISO()) return 0;
  return (timer.adjustmentMs || 0) / 60000;
}

/** Past this multiple of the budget the day counts as a real overrun — the
 * same threshold computePlantState() already uses to dock health, kept in one
 * place so the live warning and the recorded penalty can't disagree. */
export const OVERRUN_MULTIPLE = 1.5;

/**
 * Where today stands against the budget.
 *
 * `usedMin` counts the live clock *and* time already logged against attempts
 * today, because both are practice — a day where you logged two problems and
 * then ran the clock for twenty minutes has used both.
 */
export function budgetProgress(state, now = Date.now()) {
  const budgetMin = state.settings.dailyBudgetMin || 75;
  const today = todayISO();
  const loggedMin = allAttempts(state)
    .filter((a) => a.date === today)
    .reduce((sum, a) => sum + (a.timeToSolveMin || 0), 0);
  const clockMin = dayTimerElapsedMs(state, now) / 60000;
  const usedMin = loggedMin + clockMin;
  return {
    budgetMin,
    usedMin,
    loggedMin,
    clockMin,
    remainingMin: Math.max(0, budgetMin - usedMin),
    overMin: Math.max(0, usedMin - budgetMin),
    fraction: budgetMin > 0 ? usedMin / budgetMin : 0,
    over: usedMin > budgetMin,
    overrun: usedMin > budgetMin * OVERRUN_MULTIPLE,
    running: !!(state.dayTimer?.running && state.dayTimer.date === today),
  };
}

/**
 * How the plant should respond to today's clock, from -1 to +1.
 *
 * Positive as the day fills toward the budget and the plant grows into it;
 * back through zero once the budget is spent, and negative from there as it
 * shrinks. It reaches its full negative at twice the budget.
 *
 * This drives the *drawing* only, never the stored health. The plant's two
 * axes mean something — stage is cumulative and never regresses, health reads
 * the last fortnight — and a number that swung with a clock running right now
 * would belong to neither. What the user sees while they work is a preview of
 * the consequence; the consequence itself is still recorded from the attempts
 * they actually log.
 */
export function budgetPressure(state, now = Date.now()) {
  const { fraction } = budgetProgress(state, now);
  if (fraction <= 1) return fraction;           // growing into the day's target
  return Math.max(-1, 1 - (fraction - 1) * 2);  // and shrinking back past it
}

export const PLANT_STAGES = [
  { min: 0, key: "seed", label: "Seed" },
  { min: 3, key: "sprout", label: "Sprout" },
  { min: 7, key: "seedling", label: "Seedling" },
  { min: 14, key: "young", label: "Young Plant" },
  { min: 30, key: "budding", label: "Budding" },
  { min: 60, key: "flowering", label: "Flowering" },
  { min: 120, key: "tree", label: "Mature Tree" },
];

const HEALTH_WINDOW_DAYS = 14;

/** The plant is two separate axes on purpose, matching how real growth
 * actually works: `stage` is cumulative and never regresses (total distinct
 * days you've ever practiced — one bad week doesn't shrink a tree back to a
 * seed), while `health` is a volatile 0-100 read on the last two weeks of
 * behavior (can rise and fall) — pure signals, grounded in the learning
 * principles that were actually asked for: spacing/consistency, active
 * recall accuracy, not letting reviews go stale, and not cramming past the
 * point of diminishing returns in one sitting. */
export function computePlantState(state) {
  const today = todayISO();
  const activity = activityByDate(state);
  const totalDaysPracticed = Object.keys(activity).length;

  let stage = PLANT_STAGES[0];
  for (const s of PLANT_STAGES) if (totalDaysPracticed >= s.min) stage = s;
  const nextStage = PLANT_STAGES[PLANT_STAGES.indexOf(stage) + 1] || null;

  let activeDaysInWindow = 0;
  for (let i = 0; i < HEALTH_WINDOW_DAYS; i++) {
    if (activity[addDaysISO(today, -i)]) activeDaysInWindow++;
  }

  const dates = Object.keys(activity).sort();
  const lastActive = dates[dates.length - 1] || null;
  const daysSinceActive = lastActive ? daysBetween(lastActive, today) : 999;

  const recentQuiz = state.quiz.recent.slice(-10);
  const recallRate = recentQuiz.length >= 3 ? recentQuiz.filter((q) => q.correct).length / recentQuiz.length : null;

  // Backlog problems are excluded deliberately: an unstarted problem sitting
  // in the bank is not a neglected review, and counting it as one would punish
  // the user for collecting practice material.
  const overdueCount = state.problems.filter(
    (p) => !isBacklog(p) && p.nextReviewDate && daysBetween(p.nextReviewDate, today) > 7).length;

  const todaysAttempts = allAttempts(state).filter((a) => a.date === today);
  const todaysMin = todaysAttempts.reduce((sum, a) => sum + (a.timeToSolveMin || 0), 0);
  const budget = state.settings.dailyBudgetMin || 75;
  const overloaded = todaysMin > budget * 1.5 || todaysAttempts.length > 5;

  // Nothing practiced yet means there is nothing to judge. Without this, a new
  // account scored 0 and rendered as wilting before its owner had done a
  // single rep: never active (-25), no consistency (-15), and every seeded
  // problem counted as a neglected review (-20). Opening the app for the first
  // time and being shown a dying plant is the exact discouragement the plant
  // exists to prevent, and it is the same reproach in pictures that the
  // refresher wording removed from the text.
  if (totalDaysPracticed === 0) {
    return {
      stage: stage.key,
      stageLabel: stage.label,
      totalDaysPracticed: 0,
      nextStageLabel: nextStage?.label || null,
      daysToNextStage: nextStage ? nextStage.min : 0,
      health: 50,
      vitality: "steady",
      contributions: [],
      signals: { activeDaysInWindow: 0, windowDays: HEALTH_WINDOW_DAYS, daysSinceActive: null,
        recallRate: null, overdueCount: 0, overloaded: false, todaysMin: 0, budget: state.settings.dailyBudgetMin || 75 },
    };
  }

  // Built as a list of contributions rather than a running total, so the UI
  // can show what actually moved the verdict instead of asserting one. The
  // plant is this app's headline judgment and was its least explained thing:
  // it said "stressed" and left you to guess which of six inputs did it.
  //
  // Faithful by construction, the same principle as the pattern model's
  // explanations — these ARE the arithmetic, summed below, not a story told
  // about a number computed elsewhere.
  const contributions = [];
  const add = (label, delta) => { if (delta) contributions.push({ label, delta: Math.round(delta) }); };

  add(`Practised ${activeDaysInWindow} of the last ${HEALTH_WINDOW_DAYS} days`,
    Math.round((activeDaysInWindow / HEALTH_WINDOW_DAYS) * 30) - 15);
  add(`${state.streak.current}-day streak`, Math.min(15, state.streak.current * 1.5));
  if (daysSinceActive >= 7) add(`${daysSinceActive} days since you last practised`, -25);
  else if (daysSinceActive >= 3) add(`${daysSinceActive} days since you last practised`, -10);
  if (recallRate != null) {
    add(`Recognising the pattern ${Math.round(recallRate * 100)}% of the time`,
      Math.round(recallRate * 20) - 10);
  }
  add(`${overdueCount} problem${overdueCount === 1 ? "" : "s"} left a long time`,
    -Math.min(20, overdueCount * 3));
  if (overloaded) add("Today's volume is past a healthy single sitting", -15);

  const BASE_HEALTH = 50;
  let health = contributions.reduce((n, c) => n + c.delta, BASE_HEALTH);
  health = Math.max(0, Math.min(100, Math.round(health)));

  let vitality = "thriving";
  if (health < 30) vitality = "wilting";
  else if (health < 55) vitality = "stressed";
  else if (health < 80) vitality = "steady";

  return {
    stage: stage.key,
    stageLabel: stage.label,
    totalDaysPracticed,
    nextStageLabel: nextStage?.label || null,
    daysToNextStage: nextStage ? Math.max(0, nextStage.min - totalDaysPracticed) : 0,
    health,
    vitality,
    // Largest effect first: the question is "what is doing this", and the
    // answer is the top of this list.
    contributions: contributions.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
    signals: { activeDaysInWindow, windowDays: HEALTH_WINDOW_DAYS, daysSinceActive, recallRate, overdueCount, overloaded, todaysMin, budget },
  };
}

export function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}


/**
 * Score a problem's worth as a recall question. Higher is more worth asking.
 *
 * The quiz used to pick uniformly at random from everything ever attempted,
 * while sitting inside an app built entirely on a spacing algorithm — the one
 * page purely about recall was the one not using it.
 *
 * Three signals, in the order they matter:
 *   fading   how far past its interval the problem is, which is the schedule's
 *            own estimate of what you are closest to forgetting.
 *   missed   whether you got this pattern wrong last time. A pattern you
 *            misidentified is worth asking again long before one you nailed.
 *   rested   how long since it was last asked *here*, so a short session
 *            doesn't circle the same three problems.
 *
 * Exported for testing: weighting is the whole feature, and a weighting nobody
 * can inspect is indistinguishable from the random pick it replaced.
 */
export function quizPriority(problem, today = todayISO()) {
  if (!problem.attempts?.length) return 0;

  const pastInterval = problem.nextReviewDate ? daysBetween(problem.nextReviewDate, today) : 0;
  const fading = Math.max(0, pastInterval);

  const last = problem.attempts[problem.attempts.length - 1];
  const missed = last.patternGuess === "incorrect" ? 12 : 0;

  const lastPractised = lastPracticedISO(problem);
  const rested = lastPractised ? Math.min(30, Math.max(0, daysBetween(lastPractised, today))) : 30;

  // A floor of 1 so nothing is ever unreachable: a problem you are on top of
  // should be rare, not impossible, or the quiz stops being a quiz.
  return 1 + fading + missed + rested * 0.5;
}

/**
 * Choose the next quiz problem, weighted rather than uniform.
 *
 * Weighted sampling, not "take the highest": always asking the single most
 * overdue problem would make the quiz a queue with extra steps, and the point
 * of it is that the next question is not predictable.
 */
export function pickQuizProblem(state, excludeIds = [], pick = Math.random) {
  const candidates = state.problems.filter((p) => p.attempts.length > 0);
  if (candidates.length === 0) return null;
  const fresh = candidates.filter((p) => !excludeIds.includes(p.id));
  // Falling back to the full set once everything has been asked is deliberate
  // — the alternative is the quiz ending, which is not what anyone wants from
  // a drill.
  const pool = fresh.length ? fresh : candidates;

  const today = todayISO();
  const weights = pool.map((p) => quizPriority(p, today));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return pool[Math.floor(pick() * pool.length)];

  let target = pick() * total;
  for (let i = 0; i < pool.length; i++) {
    target -= weights[i];
    if (target <= 0) return pool[i];
  }
  return pool[pool.length - 1];   // floating-point slack
}

/** Builds a shuffled multiple-choice option list for the quiz: the correct
 * pattern plus up to count-1 random distractors from the other patterns. */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function quizOptions(state, correctPatternId, count = 4) {
  const others = shuffle(state.patterns.filter((p) => p.id !== correctPatternId).map((p) => p.id));
  return shuffle([correctPatternId, ...others.slice(0, count - 1)]);
}

const STALE_DAYS = 21;
const WEAK_CLEAN_RATE = 0.6;
const WEAK_MIN_ATTEMPTS = 2;

/** The single thing to do next, so opening the app never means deciding
 * where to go — just what today calls for:
 *   1. Haven't practiced yet today -> do one rep (due first, else a stale pattern).
 *   2. Already practiced today and a pattern keeps coming up wrong -> dig into
 *      that pattern specifically rather than grabbing anything new.
 *   3. A pattern hasn't been touched in a while, even though it's not
 *      technically due yet -> a gentle nudge, spaced-repetition style.
 *   4. Otherwise, whatever's next in the queue.
 *   5. Nothing left -> say so; stopping is a fine answer. */
/**
 * Pull an unstarted problem from the bank, preferring the weakest pattern the
 * bank can serve.
 *
 * This is what makes a large problem bank useful rather than just large: when
 * the review schedule is genuinely clear, the answer shouldn't be "free day"
 * if there are hundreds of unstarted problems sitting there — it should be a
 * specific next problem, chosen for the pattern that needs the work.
 */
function freshFromBank(state) {
  const bank = backlogProblems(state);
  if (!bank.length) return null;

  const bankPatterns = new Set(bank.map((p) => p.patternId));
  const weakest = patternStats(state)
    .filter((s) => bankPatterns.has(s.pattern.id))
    .sort((a, b) => {
      // Never-attempted patterns first, then worst clean-solve rate.
      const aRate = a.attempts ? a.solvedCleanRate ?? 1 : -1;
      const bRate = b.attempts ? b.solvedCleanRate ?? 1 : -1;
      return aRate - bRate;
    })[0];

  const patternId = weakest ? weakest.pattern.id : bank[0].patternId;
  const problem = bank.find((p) => p.patternId === patternId) || bank[0];
  const reason = weakest && weakest.attempts
    ? `${weakest.pattern.name} is your weakest at ${Math.round((weakest.solvedCleanRate ?? 0) * 100)}% clean-solve`
    : `you haven't attempted ${weakest ? weakest.pattern.name : "this pattern"} yet`;
  return {
    type: "fresh-volume", problem, patternId,
    message: `Nothing needs a refresher — good time for something new. ${problem.name} is in your bank, and ${reason}.`,
  };
}

export function recommendSession(state) {
  const today = todayISO();
  const todaysAttempts = allAttempts(state).filter((a) => a.date === today);
  const due = dueProblems(state);
  const duePatternIds = new Set(due.map((p) => p.patternId));

  let stale = null;
  for (const pat of state.patterns) {
    if (duePatternIds.has(pat.id)) continue;
    const atts = allAttempts(state, pat.id);
    if (!atts.length) continue;
    const daysSince = daysBetween(atts[atts.length - 1].date, today);
    if (daysSince >= STALE_DAYS && (!stale || daysSince > stale.daysSince)) {
      stale = { pattern: pat, daysSince };
    }
  }

  if (todaysAttempts.length === 0) {
    if (due.length) {
      return { type: "first-rep", problem: due[0], patternId: due[0].patternId, message: `Haven't practiced yet today — let's do one. ${due[0].name} is a good place to start.` };
    }
    if (stale) {
      const problem = state.problems.find((p) => p.patternId === stale.pattern.id);
      return { type: "stale-nudge", problem, patternId: stale.pattern.id, message: `Nothing is pressing, but ${stale.pattern.name} hasn't come up in ${stale.daysSince} days — worth a refresher before it fades.` };
    }
    const fresh = freshFromBank(state);
    if (fresh) return fresh;
    return { type: "none", problem: null, patternId: null, message: "Nothing has gone stale. Free day — browse Topics, or take it." };
  }

  const weak = patternStats(state)
    .filter((s) => s.attempts >= WEAK_MIN_ATTEMPTS && s.solvedCleanRate != null && s.solvedCleanRate < WEAK_CLEAN_RATE)
    .sort((a, b) => a.solvedCleanRate - b.solvedCleanRate)[0];
  if (weak) {
    const problem = due.find((p) => p.patternId === weak.pattern.id) || state.problems.find((p) => p.patternId === weak.pattern.id);
    return {
      type: "deep-dive", problem, patternId: weak.pattern.id,
      message: `${weak.pattern.name} is at ${Math.round(weak.solvedCleanRate * 100)}% clean-solve across ${weak.attempts} attempts — that's a repeated pattern, not a one-off. Worth reviewing the technique before drilling another rep.`,
    };
  }

  if (stale) {
    const problem = state.problems.find((p) => p.patternId === stale.pattern.id);
    return { type: "stale-nudge", problem, patternId: stale.pattern.id, message: `It's been ${stale.daysSince} days since ${stale.pattern.name} came up — a quick review would help it stick.` };
  }

  if (due.length) {
    return { type: "due", problem: due[0], patternId: due[0].patternId, message: `${due[0].name} is next in the queue.` };
  }

  return { type: "none", problem: null, patternId: null, message: "You've covered today's queue. That's a real stopping point." };
}

