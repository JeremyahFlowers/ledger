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

export function dueProblems(state) {
  const today = todayISO();
  return state.problems
    .filter((p) => !p.nextReviewDate || p.nextReviewDate <= today)
    .sort((a, b) => a.box - b.box || (a.nextReviewDate || "").localeCompare(b.nextReviewDate || ""));
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
