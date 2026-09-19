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
//   active   in the spaced-repetition rotation — it can be due, and it can go
//            overdue, which is a signal that means something.
//   backlog  collected but not started. Never due, never overdue, never
//            counted against you.
//
// Without this split, saving 300 problems from the bank would show 300 due
// today, and a week later the plant would read 300 overdue reviews and wilt —
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

/** Greedily fills today's review budget with the weakest/most-overdue
 * problems first, so a 75-minute day never silently drops what matters most. */
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
    message: `Nothing's due — good time for something new. ${problem.name} is in your bank, and ${reason}.`,
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
      return { type: "first-rep", problem: due[0], patternId: due[0].patternId, message: `Haven't practiced yet today — let's do one. ${due[0].name} is due.` };
    }
    if (stale) {
      const problem = state.problems.find((p) => p.patternId === stale.pattern.id);
      return { type: "stale-nudge", problem, patternId: stale.pattern.id, message: `Nothing's due, but ${stale.pattern.name} hasn't come up in ${stale.daysSince} days — worth a refresher before it fades.` };
    }
    const fresh = freshFromBank(state);
    if (fresh) return fresh;
    return { type: "none", problem: null, patternId: null, message: "Nothing due, nothing gone stale. Free day — browse Topics, or take it." };
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
