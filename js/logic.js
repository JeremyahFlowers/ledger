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

export const MOCK_CHECKLIST = [
  "Clarified constraints & edge cases before coding",
  "Stated approach out loud before typing",
  "Narrated trade-offs while coding",
  "Stated time/space complexity unprompted",
  "Tested with an example before declaring done",
];

/** Leitner-style box scheduling: clean solve advances a box, a struggle holds,
 * a failure resets to box 0. Mutates `problem` in place. */
export function applyOutcome(problem, outcome, settings) {
  const intervals = settings.boxIntervalsDays;
  let box = problem.box || 0;
  if (outcome === "solved-clean") box = Math.min(box + 1, intervals.length - 1);
  else if (outcome === "failed") box = 0;
  problem.box = box;
  problem.nextReviewDate = addDaysISO(todayISO(), intervals[box]);
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

export function updateStreak(state) {
  const today = todayISO();
  const streak = state.streak;
  if (streak.lastActiveDate === today) return;
  if (streak.lastActiveDate && daysBetween(streak.lastActiveDate, today) === 1) {
    streak.current += 1;
  } else {
    streak.current = 1;
  }
  streak.longest = Math.max(streak.longest || 0, streak.current);
  streak.lastActiveDate = today;
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

// ---------- Validating an imported state file ----------
//
// Import replaces the entire prep log, and it used to accept anything that
// parsed as JSON: a truncated download, an unrelated file, or a hand-edited
// one with a wrong shape silently destroyed every problem, attempt and note.
// CLAUDE.md requires validating at the boundary, and a file the user picked
// off their disk is exactly that boundary.
//
// The checks are deliberately shallow — enough to be confident this is a
// Ledger state file and to say what is in it, not a schema validator. A file
// that passes is then run through migrateState like any other.

/** Fields an import must have before it is allowed to replace anything. */
const REQUIRED_ARRAYS = ["problems", "patterns"];

/**
 * Describe a parsed import, and say whether it is safe to apply.
 *
 * Returns counts as well as problems, so the user can be shown what they are
 * about to overwrite and what with, rather than being asked to confirm a
 * change they cannot see.
 */
export function inspectImport(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, errors: ["That file doesn't contain a Ledger backup."], problems: 0, attempts: 0 };
  }

  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(candidate[key])) errors.push(`Missing its "${key}" list.`);
  }

  const problems = Array.isArray(candidate.problems) ? candidate.problems : [];
  // One malformed problem means the file was produced by something other than
  // this app, and applying the rest would leave a half-broken log.
  const malformed = problems.filter((p) => !p || typeof p !== "object" || !p.id || !p.name).length;
  if (malformed) errors.push(`${malformed} of ${problems.length} problems are missing an id or a name.`);

  const badAttempts = problems.filter(
    (p) => p && p.attempts !== undefined && !Array.isArray(p.attempts)).length;
  if (badAttempts) errors.push(`${badAttempts} problems have an unreadable attempt history.`);

  if (candidate.settings && typeof candidate.settings !== "object") {
    errors.push("Its settings are unreadable.");
  }

  const attempts = problems.reduce(
    (n, p) => n + (Array.isArray(p?.attempts) ? p.attempts.length : 0), 0);

  return {
    ok: errors.length === 0,
    errors,
    problems: problems.length,
    attempts,
    mocks: Array.isArray(candidate.mocks) ? candidate.mocks.length : 0,
    journal: Array.isArray(candidate.journal) ? candidate.journal.length : 0,
    appVersion: candidate.meta?.appVersion || null,
    createdAt: candidate.meta?.createdAt || null,
  };
}

/** One-line summary of what a state holds, for the import confirmation. */
export function describeState(state) {
  const problems = state?.problems?.length || 0;
  const attempts = (state?.problems || []).reduce(
    (n, p) => n + (Array.isArray(p?.attempts) ? p.attempts.length : 0), 0);
  return `${problems} problem${problems === 1 ? "" : "s"}, ${attempts} attempt${attempts === 1 ? "" : "s"}`;
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
  return { date: dateISO, running: false, startedAt: null, accumulatedMs: 0 };
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
  return timer.accumulatedMs + open;
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
      signals: { activeDaysInWindow: 0, windowDays: HEALTH_WINDOW_DAYS, daysSinceActive: null,
        recallRate: null, overdueCount: 0, overloaded: false, todaysMin: 0, budget: state.settings.dailyBudgetMin || 75 },
    };
  }

  let health = 50;
  health += Math.round((activeDaysInWindow / HEALTH_WINDOW_DAYS) * 30) - 15; // consistency: -15..+15
  health += Math.min(15, state.streak.current * 1.5); // streak: 0..+15
  if (daysSinceActive >= 7) health -= 25; // gone quiet
  else if (daysSinceActive >= 3) health -= 10;
  if (recallRate != null) health += Math.round(recallRate * 20) - 10; // active recall: -10..+10
  health -= Math.min(20, overdueCount * 3); // stale reviews piling up
  if (overloaded) health -= 15; // single-day cramming
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
    signals: { activeDaysInWindow, windowDays: HEALTH_WINDOW_DAYS, daysSinceActive, recallRate, overdueCount, overloaded, todaysMin, budget },
  };
}

export function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

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
export function patternTrend(state, patternId, window = 10) {
  const attempts = allAttempts(state, patternId).slice(-window);
  let solved = 0;
  return attempts.map((a, i) => {
    if (a.outcome === "solved-clean") solved += 1;
    return solved / (i + 1);
  });
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Picks a random already-attempted problem for the pattern-recognition
 * quiz, avoiding the last few asked where possible so it doesn't repeat the
 * same one twice in a row. */
export function pickQuizProblem(state, excludeIds = []) {
  const candidates = state.problems.filter((p) => p.attempts.length > 0);
  if (candidates.length === 0) return null;
  const fresh = candidates.filter((p) => !excludeIds.includes(p.id));
  const pool = fresh.length ? fresh : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Builds a shuffled multiple-choice option list for the quiz: the correct
 * pattern plus up to count-1 random distractors from the other patterns. */
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

// ---------- Progress over time ----------
//
// The app already records everything needed to answer "am I actually getting
// better?", but scattered across three pages: outcomes in the queue, recall
// accuracy in the quiz, per-pattern rates in the mastery table. These functions
// aggregate that into a trajectory.
//
// Deliberately, none of them reward volume on its own. The failure mode this
// whole app exists to prevent is grinding harder and calling it progress, so
// the measures here are about getting *better* — solving cleanly, and
// recognizing the pattern faster — with volume reported only so a spike
// followed by a collapse is visible for what it is.

const MS_PER_DAY = 86400000;
export const PROGRESS_WEEKS = 8;
/** Below this a week's rate is noise, not a trend, and is reported as null. */
const MIN_ATTEMPTS_FOR_RATE = 2;
/** A week this far above the trailing norm is a spike worth naming. */
const SPIKE_MULTIPLE = 2.5;

function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00`);
  const dayFromMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayFromMonday);
  return d.toISOString().slice(0, 10);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * One row per week, oldest first, including weeks with no activity — a gap is
 * part of the story and collapsing it would hide exactly the pattern worth
 * seeing.
 */
export function weeklyProgress(state, weeks = PROGRESS_WEEKS) {
  const attempts = allAttempts(state);
  const thisMonday = mondayOf(todayISO());

  const buckets = new Map();
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(`${thisMonday}T00:00:00`);
    d.setDate(d.getDate() - i * 7);
    buckets.set(d.toISOString().slice(0, 10), []);
  }
  for (const a of attempts) {
    const week = mondayOf(a.date);
    if (buckets.has(week)) buckets.get(week).push(a);
  }

  return [...buckets.entries()].map(([weekStart, rows]) => {
    const clean = rows.filter((a) => a.outcome === "solved-clean").length;
    const insights = rows.map((a) => a.timeToInsightMin).filter((n) => typeof n === "number");
    return {
      weekStart,
      attempts: rows.length,
      cleanRate: rows.length >= MIN_ATTEMPTS_FOR_RATE ? clean / rows.length : null,
      medianInsightMin: median(insights),
      minutes: rows.reduce((sum, a) => sum + (a.timeToSolveMin || 0), 0),
    };
  });
}

/**
 * Which patterns moved, comparing the most recent attempts against what came
 * before them.
 *
 * Split by attempt count rather than by date: practice is uneven, and a
 * fortnight where a pattern never came up says nothing about whether it
 * improved. Patterns without enough attempts on both sides are left out rather
 * than shown with a meaningless delta.
 */
export function patternMovement(state, { recent = 5, minEach = 2 } = {}) {
  const out = [];
  for (const pattern of state.patterns) {
    const attempts = allAttempts(state, pattern.id);
    if (attempts.length < minEach * 2) continue;

    const split = Math.max(minEach, attempts.length - recent);
    const before = attempts.slice(0, split);
    const after = attempts.slice(split);
    if (before.length < minEach || after.length < minEach) continue;

    const rate = (rows) => rows.filter((a) => a.outcome === "solved-clean").length / rows.length;
    const beforeRate = rate(before);
    const afterRate = rate(after);
    out.push({
      pattern,
      before: beforeRate,
      after: afterRate,
      delta: afterRate - beforeRate,
      attempts: attempts.length,
    });
  }
  return out.sort((a, b) => b.delta - a.delta);
}

/**
 * A plain-language read of the trajectory, plus anything worth flagging.
 *
 * The flag matters as much as the trend: a week at several times the usual
 * volume is the shape that precedes burning out and stopping, and this app
 * exists because that happened. Naming it while it's happening is the point.
 */
export function progressSummary(state, weeks = PROGRESS_WEEKS) {
  const rows = weeklyProgress(state, weeks);
  const rated = rows.filter((r) => r.cleanRate != null);
  const timed = rows.filter((r) => r.medianInsightMin != null);

  const half = Math.floor(rated.length / 2);
  const avg = (list, key) => (list.length ? list.reduce((s, r) => s + r[key], 0) / list.length : null);
  const cleanEarlier = half ? avg(rated.slice(0, half), "cleanRate") : null;
  const cleanRecent = half ? avg(rated.slice(half), "cleanRate") : null;

  const insightHalf = Math.floor(timed.length / 2);
  const insightEarlier = insightHalf ? avg(timed.slice(0, insightHalf), "medianInsightMin") : null;
  const insightRecent = insightHalf ? avg(timed.slice(insightHalf), "medianInsightMin") : null;

  const active = rows.filter((r) => r.attempts > 0);
  const typical = active.length > 1
    ? active.slice(0, -1).reduce((s, r) => s + r.attempts, 0) / Math.max(1, active.length - 1)
    : null;
  const latest = rows[rows.length - 1];
  const spike = typical != null && typical > 0 && latest.attempts > typical * SPIKE_MULTIPLE;

  return {
    weeks: rows,
    hasEnoughData: rated.length >= 2,
    cleanRateDelta: cleanEarlier != null && cleanRecent != null ? cleanRecent - cleanEarlier : null,
    insightDelta: insightEarlier != null && insightRecent != null ? insightRecent - insightEarlier : null,
    totalAttempts: rows.reduce((s, r) => s + r.attempts, 0),
    activeWeeks: active.length,
    spike: spike ? { attempts: latest.attempts, typical: Math.round(typical * 10) / 10 } : null,
  };
}

// ---------- Comparing two versions of the log ----------

/**
 * What differs between this device's state and the one on the server.
 *
 * A sync conflict asks you to discard one side or the other, and until now it
 * asked blind — "keep mine" or "take theirs" with no indication of what either
 * one throws away. Attempts carry stable ids, so the two sides can be compared
 * exactly rather than guessed at, and the answer is usually reassuring: most
 * conflicts are one device a few minutes stale, not a fork with real work on
 * both sides.
 *
 * Counts attempts rather than problems because attempts are the irreplaceable
 * part — a problem can be re-added in seconds, a logged rep with its timings
 * and soul statement cannot be reconstructed.
 */
export function compareStates(mine, theirs) {
  const summarize = (state) => {
    if (!state) return null;
    const attempts = allAttempts(state);
    return {
      problems: state.problems.length,
      attempts: attempts.length,
      soulStatements: attempts.filter((a) => a.soulStatement).length,
      lastActivity: attempts.length ? attempts[attempts.length - 1].date : null,
    };
  };

  const idsOf = (state) => new Set(state ? allAttempts(state).map((a) => a.id) : []);
  const mineIds = idsOf(mine);
  const theirIds = idsOf(theirs);

  const onlyMine = [...mineIds].filter((id) => !theirIds.has(id)).length;
  const onlyTheirs = [...theirIds].filter((id) => !mineIds.has(id)).length;

  return {
    mine: summarize(mine),
    theirs: summarize(theirs),
    attemptsOnlyHere: onlyMine,
    attemptsOnlyThere: onlyTheirs,
    // The reassuring case worth naming explicitly: one side is simply ahead,
    // so choosing it loses nothing at all.
    identical: onlyMine === 0 && onlyTheirs === 0,
    safeChoice: onlyMine === 0 && onlyTheirs > 0 ? "theirs"
      : onlyTheirs === 0 && onlyMine > 0 ? "mine"
      : null,
  };
}
